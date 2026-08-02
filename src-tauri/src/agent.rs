//! The design agent: a completion-model loop that edits the poster.
//!
//! The loop owns a copy of the poster document. Each turn it sends the
//! current document state plus the conversation to the completion model,
//! executes the tool calls it returns, and repeats until the model
//! finishes without tool calls or the turn budget is exhausted. Only
//! the `generate_image` tool touches the image generation model.

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::ai_client::chat::{
    self, ChatCompletionRequest, ChatCompletionResponse, ChatMessage, ToolCall, ToolCallArgs,
};
use crate::ai_client::{GenerationRequest, GenerationResult, ReferencePayload};
use crate::image_core::{ImageCoreError, Result};
use crate::settings::{AppSettings, GenerationParams};

/// The default cap on agent turns before the loop gives up.
pub const MAX_TURNS: u32 = 25;

/// A poster document as the frontend serializes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PosterDocument {
    pub width: f64,
    pub height: f64,
    /// Index 0 is the bottom layer.
    pub layers: Vec<Layer>,
    #[serde(default)]
    pub sheet_x: f64,
    #[serde(default)]
    pub sheet_y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageLayer {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub opacity: f64,
    pub blend_mode: String,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub rotation: f64,
    pub src: String,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLayer {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub opacity: f64,
    pub blend_mode: String,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub rotation: f64,
    pub text: String,
    pub font_size: f64,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeLayer {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub opacity: f64,
    pub blend_mode: String,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub rotation: f64,
    pub shape_type: String,
    pub fill: String,
    pub stroke: String,
    pub stroke_width: f64,
    pub corner_radius: f64,
    pub width: f64,
    pub height: f64,
}

/// One layer of the poster.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Layer {
    #[serde(rename = "image")]
    Image(ImageLayer),
    #[serde(rename = "text")]
    Text(TextLayer),
    #[serde(rename = "shape")]
    Shape(ShapeLayer),
}

/// The events the agent loop streams to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentEvent {
    /// A new completion turn started.
    Turn { number: u32 },
    /// The completion model called a tool.
    ToolCall {
        name: String,
        arguments: serde_json::Value,
    },
    /// A tool call finished.
    ToolResult {
        name: String,
        ok: bool,
        detail: String,
    },
    /// The image generation model is running.
    ImageProgress { phase: String },
    /// An image layer was added to the poster.
    ImageAdded { width: u32, height: u32 },
    /// The poster state after a change; the frontend adopts it.
    Document { document: PosterDocument },
    /// The loop was stopped by the user.
    Stopped,
    /// The agent finished and considers the poster done.
    Done { summary: String },
    /// A fatal loop error.
    Error { message: String },
}

/// The frontend's request to run the agent once.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRequest {
    pub prompt: String,
    pub document: PosterDocument,
    pub settings: AppSettings,
    /// Project image-generation parameters, overriding the settings.
    pub params: GenerationParams,
    pub references: Vec<ReferencePayload>,
}

/// The final outcome of an agent run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOutcome {
    pub document: PosterDocument,
    pub events: Vec<AgentEvent>,
}

/// Serialize the poster state so the completion model can plan edits.
pub fn describe_document(document: &PosterDocument) -> String {
    let mut lines = vec![format!(
        "Poster size: {:.0} x {:.0} px.",
        document.width, document.height
    )];
    if document.layers.is_empty() {
        lines.push("The poster is empty.".into());
        return lines.join("\n");
    }
    lines.push("Objects (top to bottom):".into());
    for layer in document.layers.iter().rev() {
        lines.push(format!("- {}", describe_layer(layer)));
    }
    lines.join("\n")
}

fn describe_layer(layer: &Layer) -> String {
    let base = |id: &str,
                kind: &str,
                detail: &str,
                x: f64,
                y: f64,
                rotation: f64,
                opacity: f64,
                blend: &str| {
        format!(
            "{id}: {kind}{detail} at ({x:.0}, {y:.0}), rotation {rotation:.0} deg, opacity {opacity:.2}, blend {blend}"
        )
    };
    match layer {
        Layer::Image(layer) => format!(
            "{}, size {:.0}x{:.0}",
            base(
                &layer.id,
                "image",
                &format!(" \"{}\"", layer.name),
                layer.x,
                layer.y,
                layer.rotation,
                layer.opacity,
                &layer.blend_mode
            ),
            layer.width,
            layer.height
        ),
        Layer::Text(layer) => {
            let width = layer.text.chars().count() as f64 * layer.font_size * 0.55;
            format!(
                "{}, size {:.0}x{:.0}, font {:.0}px, color {}",
                base(
                    &layer.id,
                    "text",
                    &format!(" \"{}\"", layer.text),
                    layer.x,
                    layer.y,
                    layer.rotation,
                    layer.opacity,
                    &layer.blend_mode
                ),
                width,
                layer.font_size * 1.2,
                layer.font_size,
                layer.color
            )
        }
        Layer::Shape(layer) if layer.shape_type == "line" => format!(
            "{}: line from ({:.0}, {:.0}) to ({:.0}, {:.0}), stroke {} {:.0}px, rotation {:.0} deg, opacity {:.2}",
            layer.id,
            layer.x,
            layer.y,
            layer.x + layer.width,
            layer.y + layer.height,
            layer.stroke,
            layer.stroke_width,
            layer.rotation,
            layer.opacity
        ),
        Layer::Shape(layer) => format!(
            "{}, size {:.0}x{:.0}, fill {}, stroke {} {:.0}px, corner radius {:.0}",
            base(
                &layer.id,
                &layer.shape_type,
                "",
                layer.x,
                layer.y,
                layer.rotation,
                layer.opacity,
                &layer.blend_mode
            ),
            layer.width,
            layer.height,
            layer.fill,
            layer.stroke,
            layer.stroke_width,
            layer.corner_radius
        ),
    }
}

/// Assign unique ids to objects placed by the agent.
struct IdGen {
    next: u64,
}

impl IdGen {
    fn new() -> Self {
        Self { next: 1 }
    }
    fn next(&mut self) -> String {
        let id = format!("ag-{}", self.next);
        self.next += 1;
        id
    }
}

impl PosterDocument {
    fn find_mut(&mut self, id: &str) -> Option<&mut Layer> {
        self.layers.iter_mut().find(|layer| layer_id(layer) == id)
    }

    fn apply_place(
        &mut self,
        args: &chat::PlaceObjectArgs,
        ids: &mut IdGen,
    ) -> Result<String> {
        let id = ids.next();
        let layer = match args.kind.as_str() {
            "text" => {
                let font_size =
                    args.font_size.unwrap_or_else(|| (self.width * 0.05).max(24.0));
                Layer::Text(TextLayer {
                    id: id.clone(),
                    name: "Text".into(),
                    visible: true,
                    opacity: 1.0,
                    blend_mode: "source-over".into(),
                    x: args.x,
                    y: args.y,
                    rotation: args.rotation.unwrap_or(0.0),
                    text: args.content.clone().unwrap_or_default(),
                    font_size,
                    color: args.color.clone().unwrap_or_else(|| "#1a1a1f".into()),
                })
            }
            "rect" | "ellipse" => {
                let is_rect = args.kind == "rect";
                Layer::Shape(ShapeLayer {
                    id: id.clone(),
                    name: if is_rect { "Rectangle" } else { "Ellipse" }.into(),
                    visible: true,
                    opacity: 1.0,
                    blend_mode: "source-over".into(),
                    x: args.x,
                    y: args.y,
                    rotation: args.rotation.unwrap_or(0.0),
                    shape_type: args.kind.clone(),
                    fill: args.fill.clone().unwrap_or_else(|| "#1a1a1f".into()),
                    stroke: args.stroke.clone().unwrap_or_else(|| "#1a1a1f".into()),
                    stroke_width: args.stroke_width.unwrap_or(0.0),
                    corner_radius: args.corner_radius.unwrap_or(0.0),
                    width: args.width.unwrap_or(0.0),
                    height: args.height.unwrap_or(0.0),
                })
            }
            "line" => Layer::Shape(ShapeLayer {
                id: id.clone(),
                name: "Line".into(),
                visible: true,
                opacity: 1.0,
                blend_mode: "source-over".into(),
                x: args.x,
                y: args.y,
                rotation: args.rotation.unwrap_or(0.0),
                shape_type: "line".into(),
                fill: "#00000000".into(),
                stroke: args.stroke.clone().unwrap_or_else(|| "#1a1a1f".into()),
                stroke_width: args.stroke_width.unwrap_or(4.0),
                corner_radius: 0.0,
                width: args.width.unwrap_or(0.0),
                height: args.height.unwrap_or(0.0),
            }),
            _ => return Err(ImageCoreError::Message("unknown shape kind".into())),
        };
        self.layers.push(layer);
        Ok(id)
    }

    fn apply_move(&mut self, args: &chat::MoveObjectArgs) -> Result<()> {
        let layer = self
            .find_mut(&args.id)
            .ok_or_else(|| ImageCoreError::Message(format!("no object {}", args.id)))?;
        set_layer_pos(layer, args.x, args.y);
        Ok(())
    }

    fn apply_delete(&mut self, args: &chat::DeleteObjectArgs) -> Result<()> {
        let before = self.layers.len();
        self.layers.retain(|layer| layer_id(layer) != args.id);
        if self.layers.len() == before {
            return Err(ImageCoreError::Message(format!(
                "no object {}",
                args.id
            )));
        }
        Ok(())
    }

    fn apply_rotate(&mut self, args: &chat::RotateObjectArgs) -> Result<()> {
        let layer = self
            .find_mut(&args.id)
            .ok_or_else(|| ImageCoreError::Message(format!("no object {}", args.id)))?;
        let rotation = layer_rotation(layer) + args.degrees;
        set_layer_rotation(layer, normalize_degrees(rotation));
        Ok(())
    }

    fn apply_edit(&mut self, args: &chat::EditObjectPropertyArgs) -> Result<()> {
        let layer = self
            .find_mut(&args.id)
            .ok_or_else(|| ImageCoreError::Message(format!("no object {}", args.id)))?;
        edit_layer(layer, &args.property, &args.value)
    }

    fn add_image(&mut self, result: &GenerationResult, ids: &mut IdGen) -> Result<()> {
        let scale = (self.width / result.width as f64)
            .min(self.height / result.height as f64);
        let width = (result.width as f64 * scale).max(1.0);
        let height = (result.height as f64 * scale).max(1.0);
        self.layers.push(Layer::Image(ImageLayer {
            id: ids.next(),
            name: "Generated image".into(),
            visible: true,
            opacity: 1.0,
            blend_mode: "source-over".into(),
            x: (self.width - width) / 2.0,
            y: (self.height - height) / 2.0,
            rotation: 0.0,
            src: result.data_url.clone(),
            width,
            height,
        }));
        Ok(())
    }
}

fn layer_id(layer: &Layer) -> &str {
    match layer {
        Layer::Image(layer) => &layer.id,
        Layer::Text(layer) => &layer.id,
        Layer::Shape(layer) => &layer.id,
    }
}

fn layer_rotation(layer: &Layer) -> f64 {
    match layer {
        Layer::Image(layer) => layer.rotation,
        Layer::Text(layer) => layer.rotation,
        Layer::Shape(layer) => layer.rotation,
    }
}

fn set_layer_pos(layer: &mut Layer, x: f64, y: f64) {
    match layer {
        Layer::Image(layer) => {
            layer.x = x;
            layer.y = y;
        }
        Layer::Text(layer) => {
            layer.x = x;
            layer.y = y;
        }
        Layer::Shape(layer) => {
            layer.x = x;
            layer.y = y;
        }
    }
}

fn set_layer_rotation(layer: &mut Layer, rotation: f64) {
    match layer {
        Layer::Image(layer) => layer.rotation = rotation,
        Layer::Text(layer) => layer.rotation = rotation,
        Layer::Shape(layer) => layer.rotation = rotation,
    }
}

fn layer_x(layer: &Layer) -> f64 {
    match layer {
        Layer::Image(layer) => layer.x,
        Layer::Text(layer) => layer.x,
        Layer::Shape(layer) => layer.x,
    }
}

fn layer_y(layer: &Layer) -> f64 {
    match layer {
        Layer::Image(layer) => layer.y,
        Layer::Text(layer) => layer.y,
        Layer::Shape(layer) => layer.y,
    }
}

/// Keep a rotation value in the -180..180 range.
pub fn normalize_degrees(mut degrees: f64) -> f64 {
    degrees = degrees.rem_euclid(360.0);
    if degrees > 180.0 {
        degrees -= 360.0;
    }
    degrees
}

fn edit_layer(layer: &mut Layer, property: &str, value: &serde_json::Value) -> Result<()> {
    let number = || {
        value
            .as_f64()
            .ok_or_else(|| ImageCoreError::Message("value must be a number".into()))
    };
    match property {
        "x" | "y" => {
            let number = number()?;
            set_layer_pos(
                layer,
                if property == "x" { number } else { layer_x(layer) },
                if property == "y" { number } else { layer_y(layer) },
            );
            Ok(())
        }
        "width" | "height" => match layer {
            Layer::Image(layer) => {
                if property == "width" {
                    layer.width = number()?;
                } else {
                    layer.height = number()?;
                }
                Ok(())
            }
            Layer::Shape(layer) => {
                if property == "width" {
                    layer.width = number()?;
                } else {
                    layer.height = number()?;
                }
                Ok(())
            }
            Layer::Text(_) => Err(ImageCoreError::Message(
                "text width and height are derived from fontSize".into(),
            )),
        },
        "rotation" => {
            set_layer_rotation(layer, normalize_degrees(number()?));
            Ok(())
        }
        "opacity" => {
            let opacity = number()?;
            match layer {
                Layer::Image(layer) => layer.opacity = opacity,
                Layer::Text(layer) => layer.opacity = opacity,
                Layer::Shape(layer) => layer.opacity = opacity,
            }
            Ok(())
        }
        "blendMode" => {
            let mode = value
                .as_str()
                .ok_or_else(|| ImageCoreError::Message("blendMode must be a string".into()))?;
            match layer {
                Layer::Image(layer) => layer.blend_mode = mode.into(),
                Layer::Text(layer) => layer.blend_mode = mode.into(),
                Layer::Shape(layer) => layer.blend_mode = mode.into(),
            }
            Ok(())
        }
        "visible" => {
            let visible = value
                .as_bool()
                .ok_or_else(|| ImageCoreError::Message("visible must be a boolean".into()))?;
            match layer {
                Layer::Image(layer) => layer.visible = visible,
                Layer::Text(layer) => layer.visible = visible,
                Layer::Shape(layer) => layer.visible = visible,
            }
            Ok(())
        }
        "text" => match layer {
            Layer::Text(layer) => {
                layer.text = value
                    .as_str()
                    .ok_or_else(|| ImageCoreError::Message("text must be a string".into()))?
                    .to_string();
                Ok(())
            }
            _ => Err(ImageCoreError::Message("object is not text".into())),
        },
        "fontSize" => match layer {
            Layer::Text(layer) => {
                let size = number()?;
                if size <= 0.0 {
                    return Err(ImageCoreError::Message(
                        "fontSize must be positive".into(),
                    ));
                }
                layer.font_size = size;
                Ok(())
            }
            _ => Err(ImageCoreError::Message("object is not text".into())),
        },
        "color" => match layer {
            Layer::Text(layer) => {
                layer.color = value
                    .as_str()
                    .ok_or_else(|| ImageCoreError::Message("color must be a string".into()))?
                    .to_string();
                Ok(())
            }
            _ => Err(ImageCoreError::Message("object is not text".into())),
        },
        "fill" | "stroke" | "strokeWidth" | "cornerRadius" => match layer {
            Layer::Shape(layer) => {
                if property == "fill" || property == "stroke" {
                    let color = value.as_str().ok_or_else(|| {
                        ImageCoreError::Message(format!("{property} must be a string"))
                    })?;
                    if property == "fill" {
                        layer.fill = color.to_string();
                    } else {
                        layer.stroke = color.to_string();
                    }
                } else {
                    let width = number()?;
                    if width < 0.0 {
                        return Err(ImageCoreError::Message(format!(
                            "{property} must be zero or positive"
                        )));
                    }
                    if property == "strokeWidth" {
                        layer.stroke_width = width;
                    } else {
                        layer.corner_radius = width;
                    }
                }
                Ok(())
            }
            _ => Err(ImageCoreError::Message("object is not a shape".into())),
        },
        _ => Err(ImageCoreError::Message(format!(
            "unknown property {property}"
        ))),
    }
}

fn push_event<E: FnMut(&AgentEvent)>(
    events: &mut Vec<AgentEvent>,
    emit: &mut E,
    event: &AgentEvent,
) {
    events.push(event.clone());
    emit(event);
}

/// Run the agent loop against injected completers so tests can script
/// the completion model without a network.
#[allow(clippy::too_many_arguments)]
pub async fn run_agent<F, Fut, G, Gfut, E>(
    request: AgentRequest,
    stop: Arc<AtomicBool>,
    max_turns: u32,
    mut emit: E,
    complete_fn: F,
    image_fn: G,
) -> Result<AgentOutcome>
where
    F: Fn(ChatCompletionRequest) -> Fut + Send + Sync,
    Fut: Future<Output = Result<ChatCompletionResponse>> + Send,
    G: Fn(GenerationRequest) -> Gfut + Send + Sync,
    Gfut: Future<Output = Result<GenerationResult>> + Send,
    E: FnMut(&AgentEvent),
{
    let mut document = request.document.clone();
    let mut ids = IdGen::new();
    let mut events: Vec<AgentEvent> = Vec::new();
    let mut messages = vec![
        ChatMessage {
            role: "system".into(),
            content: chat::system_prompt(document.width, document.height),
            tool_calls: None,
            tool_call_id: None,
        },
        ChatMessage {
            role: "user".into(),
            content: request.prompt.clone(),
            tool_calls: None,
            tool_call_id: None,
        },
    ];

    for turn in 1..=max_turns {
        if stop.load(Ordering::Relaxed) {
            push_event(&mut events, &mut emit, &AgentEvent::Stopped);
            return Ok(AgentOutcome { document, events });
        }
        push_event(&mut events, &mut emit, &AgentEvent::Turn { number: turn });
        // Serialize the current document into the context each turn.
        messages.push(ChatMessage {
            role: "system".into(),
            content: format!("Current poster state:\n{}", describe_document(&document)),
            tool_calls: None,
            tool_call_id: None,
        });
        let response = complete_fn(ChatCompletionRequest {
            model: String::new(),
            messages: messages.clone(),
            tools: chat::tool_definitions(),
            tool_choice: Some("auto".into()),
            temperature: Some(0.7),
        })
        .await?;
        let choice = response
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| ImageCoreError::Message("completion returned no choices".into()))?;
        let tool_calls = choice.message.tool_calls;
        if tool_calls.is_empty() {
            let summary = choice.message.content.unwrap_or_default().trim().to_string();
            let summary = if summary.is_empty() {
                "Done".into()
            } else {
                summary
            };
            push_event(&mut events, &mut emit, &AgentEvent::Done { summary });
            return Ok(AgentOutcome { document, events });
        }
        // Record the assistant turn with its tool calls.
        messages.push(ChatMessage {
            role: "assistant".into(),
            content: String::new(),
            tool_calls: Some(
                tool_calls
                    .iter()
                    .map(|call| ToolCall {
                        id: call.id.clone(),
                        kind: "function".into(),
                        function: chat::ToolCallFunction {
                            name: call.function.name.clone(),
                            arguments: call.function.arguments.clone(),
                        },
                    })
                    .collect(),
            ),
            tool_call_id: None,
        });
        for call in &tool_calls {
            let name = call.function.name.clone();
            let arguments: serde_json::Value =
                serde_json::from_str(&call.function.arguments)
                    .unwrap_or(serde_json::json!({"raw": call.function.arguments}));
            push_event(
                &mut events,
                &mut emit,
                &AgentEvent::ToolCall {
                    name: name.clone(),
                    arguments,
                },
            );
            let outcome = execute_tool_call(
                &name,
                &call.function.arguments,
                &mut document,
                &mut ids,
                &request,
                &image_fn,
                &mut events,
                &mut emit,
            )
            .await;
            let (ok, detail) = match outcome {
                Ok(detail) => (true, detail),
                Err(error) => (false, error.to_string()),
            };
            push_event(
                &mut events,
                &mut emit,
                &AgentEvent::ToolResult {
                    name: name.clone(),
                    ok,
                    detail: detail.clone(),
                },
            );
            messages.push(ChatMessage {
                role: "tool".into(),
                content: detail,
                tool_call_id: Some(call.id.clone()),
                tool_calls: None,
            });
        }
    }
    push_event(
        &mut events,
        &mut emit,
        &AgentEvent::Error {
            message: format!("the agent reached the {max_turns}-turn limit"),
        },
    );
    Ok(AgentOutcome { document, events })
}

/// Execute one tool call and return the result summary.
#[allow(clippy::too_many_arguments)]
async fn execute_tool_call<G, Gfut, E>(
    name: &str,
    arguments: &str,
    document: &mut PosterDocument,
    ids: &mut IdGen,
    request: &AgentRequest,
    image_fn: &G,
    events: &mut Vec<AgentEvent>,
    emit: &mut E,
) -> Result<String>
where
    G: Fn(GenerationRequest) -> Gfut + Send + Sync,
    Gfut: Future<Output = Result<GenerationResult>> + Send,
    E: FnMut(&AgentEvent),
{
    let call = chat::parse_tool_call(name, arguments)?;
    chat::validate_tool_call(&call, document.width, document.height)?;
    match &call {
        ToolCallArgs::PlaceObject(args) => {
            let id = document.apply_place(args, ids)?;
            emit_document(document, events, emit);
            Ok(format!("placed {} as {id}", args.kind))
        }
        ToolCallArgs::MoveObject(args) => {
            document.apply_move(args)?;
            emit_document(document, events, emit);
            Ok(format!("moved {} to ({:.0}, {:.0})", args.id, args.x, args.y))
        }
        ToolCallArgs::DeleteObject(args) => {
            document.apply_delete(args)?;
            emit_document(document, events, emit);
            Ok(format!("deleted {}", args.id))
        }
        ToolCallArgs::RotateObject(args) => {
            document.apply_rotate(args)?;
            emit_document(document, events, emit);
            Ok(format!("rotated {} by {:.0} degrees", args.id, args.degrees))
        }
        ToolCallArgs::EditObjectProperty(args) => {
            document.apply_edit(args)?;
            emit_document(document, events, emit);
            Ok(format!("set {} of {}", args.property, args.id))
        }
        ToolCallArgs::GenerateImage(args) => {
            let mut image_settings = request.settings.clone();
            image_settings.params = request.params.clone();
            let generation = GenerationRequest {
                settings: image_settings,
                prompt: args.prompt.clone(),
                references: request.references.clone(),
            };
            push_event(events, emit, &AgentEvent::ImageProgress {
                phase: "generating".into(),
            });
            let result = image_fn(generation).await?;
            let width = result.width;
            let height = result.height;
            document.add_image(&result, ids)?;
            push_event(events, emit, &AgentEvent::ImageAdded { width, height });
            emit_document(document, events, emit);
            Ok(format!(
                "generated {}x{} image and placed it centered",
                result.width, result.height
            ))
        }
    }
}

fn emit_document<E: FnMut(&AgentEvent)>(
    document: &PosterDocument,
    events: &mut Vec<AgentEvent>,
    emit: &mut E,
) {
    push_event(
        events,
        emit,
        &AgentEvent::Document {
            document: document.clone(),
        },
    );
}

static STOP_FLAG: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();

fn stop_slot() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    STOP_FLAG.get_or_init(|| Mutex::new(None))
}

/// Register a stop flag for the current run and return a handle to it.
pub fn register_stop_flag() -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    *stop_slot().lock().unwrap() = Some(flag.clone());
    flag
}

/// Request the running agent to stop.
pub fn request_stop() {
    if let Some(flag) = stop_slot().lock().unwrap().as_ref() {
        flag.store(true, Ordering::Relaxed);
    }
}

/// Forget the stop flag after a run finishes.
pub fn clear_stop_flag() {
    *stop_slot().lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_client::chat::{ResponseMessage, ResponseToolCall, ResponseToolFunction};
    use std::collections::VecDeque;
    use std::sync::Mutex;

    fn text_response(content: &str) -> ChatCompletionResponse {
        ChatCompletionResponse {
            choices: vec![crate::ai_client::chat::Choice {
                message: ResponseMessage {
                    content: Some(content.into()),
                    tool_calls: vec![],
                },
                finish_reason: Some("stop".into()),
            }],
        }
    }

    fn tool_response(id: &str, name: &str, arguments: &str) -> ChatCompletionResponse {
        ChatCompletionResponse {
            choices: vec![crate::ai_client::chat::Choice {
                message: ResponseMessage {
                    content: None,
                    tool_calls: vec![ResponseToolCall {
                        id: id.into(),
                        function: ResponseToolFunction {
                            name: name.into(),
                            arguments: arguments.into(),
                        },
                    }],
                },
                finish_reason: Some("tool_calls".into()),
            }],
        }
    }

    fn request(prompt: &str) -> AgentRequest {
        AgentRequest {
            prompt: prompt.into(),
            document: PosterDocument {
                width: 1024.0,
                height: 1536.0,
                layers: vec![],
                sheet_x: 0.0,
                sheet_y: 0.0,
            },
            settings: AppSettings::default(),
            params: GenerationParams::default(),
            references: vec![],
        }
    }

    fn image(width: u32, height: u32) -> GenerationResult {
        GenerationResult {
            data_url: "data:image/png;base64,cg==".into(),
            width,
            height,
        }
    }

    async fn run_scripted(
        req: AgentRequest,
        responses: Vec<ChatCompletionResponse>,
        max_turns: u32,
        stop: Arc<AtomicBool>,
    ) -> AgentOutcome {
        let queue: Arc<Mutex<VecDeque<ChatCompletionResponse>>> =
            Arc::new(Mutex::new(responses.into()));
        let queue_clone = queue.clone();
        let events: Arc<Mutex<Vec<AgentEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let events_clone = events.clone();
        run_agent(
            req,
            stop,
            max_turns,
            move |event| events_clone.lock().unwrap().push(event.clone()),
            move |_request| {
                let next = queue_clone.lock().unwrap().pop_front();
                async move {
                    next.ok_or_else(|| {
                        ImageCoreError::Message("no more scripted responses".into())
                    })
                }
            },
            move |_generation| {
                let result = image(512, 512);
                async move { Ok(result) }
            },
        )
        .await
        .unwrap()
    }

    fn event_names(outcome: &AgentOutcome) -> Vec<&str> {
        outcome
            .events
            .iter()
            .map(|event| match event {
                AgentEvent::Turn { .. } => "turn",
                AgentEvent::ToolCall { .. } => "tool_call",
                AgentEvent::ToolResult { .. } => "tool_result",
                AgentEvent::ImageProgress { .. } => "image_progress",
                AgentEvent::ImageAdded { .. } => "image_added",
                AgentEvent::Document { .. } => "document",
                AgentEvent::Stopped => "stopped",
                AgentEvent::Done { .. } => "done",
                AgentEvent::Error { .. } => "error",
            })
            .collect()
    }

    #[tokio::test]
    async fn loop_runs_all_six_tools_and_finishes() {
        let responses = vec![
            tool_response(
                "c1",
                "place_object",
                r##"{"kind":"rect","x":100,"y":100,"width":300,"height":200,"fill":"#f2c14e"}"##,
            ),
            tool_response(
                "c2",
                "place_object",
                r##"{"kind":"text","x":512,"y":80,"content":"SUMMER","fontSize":120,"color":"#1a1a1f"}"##,
            ),
            tool_response("c3", "move_object", r##"{"id":"ag-1","x":150,"y":150}"##),
            tool_response("c4", "rotate_object", r##"{"id":"ag-2","degrees":15}"##),
            tool_response(
                "c5",
                "edit_object_property",
                r##"{"id":"ag-1","property":"opacity","value":0.5}"##,
            ),
            tool_response(
                "c6",
                "generate_image",
                r##"{"prompt":"a beach scene with waves"}"##,
            ),
            tool_response("c7", "delete_object", r##"{"id":"ag-1"}"##),
            text_response("Here is the poster."),
        ];
        let outcome = run_scripted(request("make a beach poster"), responses, 20, Arc::new(AtomicBool::new(false))).await;

        let names = event_names(&outcome);
        assert_eq!(names.last().unwrap(), &"done");
        assert!(names.iter().filter(|n| **n == "turn").count() == 8);
        assert!(names.iter().filter(|n| **n == "tool_result").count() == 7);
        assert!(names.iter().filter(|n| **n == "document").count() == 7);

        let layers = &outcome.document.layers;
        assert_eq!(layers.len(), 2, "rect deleted, text and image remain");
        let text = match &layers[0] {
            Layer::Text(layer) => layer,
            other => panic!("expected text layer, got {other:?}"),
        };
        assert_eq!(text.text, "SUMMER");
        assert_eq!(text.rotation, 15.0);
        let image_layer = match &layers[1] {
            Layer::Image(layer) => layer,
            other => panic!("expected image layer, got {other:?}"),
        };
        // 512x512 into 1024x1536 fits at scale 2, centered horizontally.
        assert_eq!(image_layer.width, 1024.0);
        assert_eq!(image_layer.height, 1024.0);
        assert_eq!(image_layer.x, 0.0);
        assert_eq!(image_layer.y, 256.0);
    }

    #[tokio::test]
    async fn guardrail_refusal_is_reported_and_loop_recovers() {
        let responses = vec![
            tool_response(
                "c1",
                "generate_image",
                r##"{"prompt":"a beach with the text SURF"}"##,
            ),
            tool_response(
                "c2",
                "generate_image",
                r##"{"prompt":"a beach scene with waves"}"##,
            ),
            text_response("done"),
        ];
        let outcome = run_scripted(request("beach"), responses, 10, Arc::new(AtomicBool::new(false))).await;

        let results: Vec<&AgentEvent> = outcome
            .events
            .iter()
            .filter(|event| matches!(event, AgentEvent::ToolResult { .. }))
            .collect();
        assert_eq!(results.len(), 2);
        let first = match results[0] {
            AgentEvent::ToolResult { ok, detail, .. } => (ok, detail),
            _ => unreachable!(),
        };
        assert!(!first.0, "the text prompt must be refused");
        assert!(first.1.contains("Refused"), "{}", first.1);
        let second = match results[1] {
            AgentEvent::ToolResult { ok, detail, .. } => (ok, detail),
            _ => unreachable!(),
        };
        assert!(second.0, "the recovered prompt must succeed");
        assert!(second.1.contains("placed"), "{}", second.1);
        // The final document has the one image the guardrail allowed.
        assert_eq!(outcome.document.layers.len(), 1);
        assert!(matches!(outcome.document.layers[0], Layer::Image(_)));
    }

    #[tokio::test]
    async fn unknown_tool_and_bad_args_fail_the_call_not_the_loop() {
        let responses = vec![
            tool_response("c1", "teleport", "{}"),
            tool_response(
                "c2",
                "place_object",
                r##"{"kind":"rect","x":0,"y":0,"width":10,"height":10,"fill":"nope"}"##,
            ),
            text_response("done"),
        ];
        let outcome = run_scripted(request("x"), responses, 5, Arc::new(AtomicBool::new(false))).await;

        let details: Vec<String> = outcome
            .events
            .iter()
            .filter_map(|event| match event {
                AgentEvent::ToolResult { ok: false, detail, .. } => Some(detail.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(details.len(), 2);
        assert!(details[0].contains("unknown tool"), "{}", details[0]);
        assert!(details[1].contains("#rrggbb"), "{}", details[1]);
        // Nothing was placed.
        assert!(outcome.document.layers.is_empty());
    }

    #[tokio::test]
    async fn loop_hits_the_turn_limit() {
        let responses = vec![
            tool_response("c1", "place_object", r##"{"kind":"rect","x":0,"y":0,"width":10,"height":10}"##),
            tool_response("c2", "move_object", r##"{"id":"ag-1","x":5,"y":5}"##),
            tool_response("c3", "move_object", r##"{"id":"ag-1","x":6,"y":6}"##),
        ];
        let outcome = run_scripted(request("x"), responses, 3, Arc::new(AtomicBool::new(false))).await;
        let names = event_names(&outcome);
        assert_eq!(names.last().unwrap(), &"error");
        let error = outcome.events.last().unwrap();
        assert!(matches!(error, AgentEvent::Error { .. }));
        // The loop executed all three turns before giving up.
        assert!(names.iter().filter(|n| **n == "turn").count() == 3);
    }

    #[tokio::test]
    async fn stop_flag_aborts_between_turns() {
        let responses = vec![tool_response(
            "c1",
            "place_object",
            r##"{"kind":"rect","x":0,"y":0,"width":10,"height":10}"##,
        )];
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();
        let queue: Arc<Mutex<VecDeque<ChatCompletionResponse>>> =
            Arc::new(Mutex::new(responses.into()));
        let queue_clone = queue.clone();
        let events: Arc<Mutex<Vec<AgentEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let events_clone = events.clone();
        let outcome = run_agent(
            request("x"),
            stop,
            10,
            move |event| events_clone.lock().unwrap().push(event.clone()),
            move |_req| {
                // Signal the stop on the first completion call.
                stop_clone.store(true, Ordering::Relaxed);
                let next = queue_clone.lock().unwrap().pop_front();
                async move {
                    next.ok_or_else(|| {
                        ImageCoreError::Message("no more scripted responses".into())
                    })
                }
            },
            move |_generation| async move {
                Ok(image(512, 512))
            },
        )
        .await
        .unwrap();
        let names = event_names(&outcome);
        assert!(names.contains(&"stopped"));
        assert!(!names.contains(&"done"));
        assert!(!names.contains(&"error"));
        // The rect placed in the first turn survived.
        assert_eq!(outcome.document.layers.len(), 1);
    }

    #[test]
    fn describe_document_lists_layers_top_to_bottom() {
        let mut document = request("x").document;
        document.layers.push(Layer::Text(TextLayer {
            id: "ag-1".into(),
            name: "Text".into(),
            visible: true,
            opacity: 1.0,
            blend_mode: "source-over".into(),
            x: 512.0,
            y: 80.0,
            rotation: 15.0,
            text: "SUMMER".into(),
            font_size: 120.0,
            color: "#1a1a1f".into(),
        }));
        document.layers.push(Layer::Shape(ShapeLayer {
            id: "ag-2".into(),
            name: "Rectangle".into(),
            visible: true,
            opacity: 0.5,
            blend_mode: "source-over".into(),
            x: 100.0,
            y: 100.0,
            rotation: 0.0,
            shape_type: "rect".into(),
            fill: "#f2c14e".into(),
            stroke: "#1a1a1f".into(),
            stroke_width: 2.0,
            corner_radius: 12.0,
            width: 300.0,
            height: 200.0,
        }));
        let text = describe_document(&document);
        // Topmost layer first: the shape is above the text.
        let rect_pos = text.find("ag-2").unwrap();
        let text_pos = text.find("ag-1").unwrap();
        assert!(rect_pos < text_pos, "{text}");
        assert!(text.contains("1024 x 1536"), "{text}");
        assert!(text.contains("SUMMER"), "{text}");
        assert!(text.contains("rotation 15 deg"), "{text}");
        assert!(text.contains("opacity 0.50"), "{text}");
    }
}
