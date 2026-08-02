//! Completion model client for the design agent.
//!
//! The client talks to an OpenAI-compatible chat-completions endpoint.
//! The completion model plans poster edits and calls tools; only the
//! `generate_image` tool touches the image generation model.

use serde::{Deserialize, Serialize};

use super::http_client;
use crate::image_core::{ImageCoreError, Result};
use crate::settings::CompletionSettings;

/// One message in the chat conversation.
#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    /// One of "system", "user", "assistant", or "tool".
    pub role: String,
    pub content: String,
    /// Present on assistant messages that call tools.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    /// Present on tool messages that answer a tool call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: ToolCallFunction,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolCallFunction {
    pub name: String,
    /// JSON string with the tool arguments.
    pub arguments: String,
}

/// A request to a chat-completions endpoint. Field names follow the
/// OpenAI-compatible wire format (snake_case).
#[derive(Debug, Clone, Serialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
}

/// The completion model's answer to a chat request.
#[derive(Debug, Clone, Deserialize)]
pub struct ChatCompletionResponse {
    pub choices: Vec<Choice>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Choice {
    pub message: ResponseMessage,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResponseMessage {
    pub content: Option<String>,
    #[serde(default)]
    pub tool_calls: Vec<ResponseToolCall>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResponseToolCall {
    pub id: String,
    pub function: ResponseToolFunction,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResponseToolFunction {
    pub name: String,
    /// JSON string with the tool arguments.
    pub arguments: String,
}

/// Build the JSON schema for one function tool.
fn tool_fn(name: &str, description: &str, parameters: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        }
    })
}

/// The six tools the completion model may call.
pub fn tool_definitions() -> Vec<serde_json::Value> {
    vec![
        tool_fn(
            "place_object",
            "Place a new text or simple geometry object (rect, ellipse, or line) on the poster. Text is rendered by the app with a bundled font; never ask the image model for text. Coordinates are poster pixels from the top-left.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["text", "rect", "ellipse", "line"]},
                    "x": {"type": "number", "description": "Left edge for text, rect, and ellipse; the start point x for a line."},
                    "y": {"type": "number", "description": "Top edge for text, rect, and ellipse; the start point y for a line."},
                    "width": {"type": "number", "description": "Required for rect, ellipse, and line. For a line this is the horizontal run from the start point."},
                    "height": {"type": "number", "description": "Required for rect, ellipse, and line. For a line this is the vertical run from the start point."},
                    "content": {"type": "string", "description": "The text content. Required when kind is text."},
                    "fontSize": {"type": "number", "description": "Text size in poster pixels."},
                    "color": {"type": "string", "description": "Text color as #rrggbb or #rrggbbaa."},
                    "fill": {"type": "string", "description": "Fill color for rect and ellipse as #rrggbb or #rrggbbaa."},
                    "stroke": {"type": "string", "description": "Stroke color as #rrggbb or #rrggbbaa."},
                    "strokeWidth": {"type": "number", "description": "Stroke width in poster pixels."},
                    "cornerRadius": {"type": "number", "description": "Corner radius for a rect in poster pixels."},
                    "rotation": {"type": "number", "description": "Rotation in degrees clockwise around the center."}
                },
                "required": ["kind", "x", "y"]
            }),
        ),
        tool_fn(
            "move_object",
            "Move an existing object to a new top-left position in poster pixels.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "The object id."},
                    "x": {"type": "number"},
                    "y": {"type": "number"}
                },
                "required": ["id", "x", "y"]
            }),
        ),
        tool_fn(
            "delete_object",
            "Delete an object from the poster.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "The object id."}
                },
                "required": ["id"]
            }),
        ),
        tool_fn(
            "rotate_object",
            "Rotate an object around its center by a number of degrees clockwise.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "The object id."},
                    "degrees": {"type": "number", "description": "Rotation in degrees clockwise."}
                },
                "required": ["id", "degrees"]
            }),
        ),
        tool_fn(
            "edit_object_property",
            "Edit one property of an existing object, for example its size, opacity, blend mode, text, or colors.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "The object id."},
                    "property": {"type": "string", "enum": ["x", "y", "width", "height", "rotation", "opacity", "blendMode", "visible", "text", "fontSize", "color", "fill", "stroke", "strokeWidth", "cornerRadius"]},
                    "value": {"description": "The new value: a number, string, or boolean depending on the property."}
                },
                "required": ["id", "property", "value"]
            }),
        ),
        tool_fn(
            "generate_image",
            "Generate a graphic image with the image generation model and add it to the poster. The image model renders graphics, illustration, and logos only: it CANNOT render text, titles, words, captions, labels, letters, or numbers as text. Describe only visual graphics in the prompt.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "A graphics-only description of the image to generate. No text of any kind."}
                },
                "required": ["prompt"]
            }),
        ),
    ]
}

/// The anti-slop system instruction embedded in the completion prompt.
pub fn system_prompt(poster_width: f64, poster_height: f64) -> String {
    format!(
        "You are the design agent for Literative, a poster design tool. \
You turn the user's request into a finished poster by calling tools. \
The poster is {:.0} pixels wide and {:.0} pixels tall; coordinates are poster pixels from the top-left. \
You edit the existing objects: place_object, move_object, delete_object, rotate_object, and edit_object_property. \
place_object places text or simple geometry (rect, ellipse, line). \
The image model CANNOT generate text of any kind: no titles, headlines, captions, labels, slogans, words, letters, or numbers as text. \
It produces graphics, illustration, and logos only. \
Never ask generate_image for text. If the design needs text, place it with place_object and let the app render it. \
Text on a poster is rendered by the app with a bundled font, so it is always crisp. \
When you place text, write plain characters. Never escape punctuation into HTML entities: \
use the literal ampersand, never &amp;, unless the user explicitly asks for the entity. \
Work step by step: place the background and elements first, then refine. \
When the poster matches the request, stop calling tools and reply with a short summary of what you made.",
        poster_width, poster_height
    )
}

/// The anti-slop guardrail.
///
/// Returns a refusal message when the generate_image prompt asks the
/// image model to render text, and None for a graphics-only prompt.
pub fn text_request_refusal(prompt: &str) -> Option<String> {
    let lower = prompt.to_lowercase();
    let bytes = lower.as_bytes();
    // Collect every word-boundary hit of a text keyword with its index.
    let mut hits: Vec<(&str, usize)> = Vec::new();
    for word in TEXT_KEYWORDS {
        let mut from = 0;
        while let Some(offset) = lower[from..].find(word) {
            let start = from + offset;
            let end = start + word.len();
            let before_ok =
                start == 0 || !bytes[start - 1].is_ascii_alphanumeric();
            let after_ok =
                end >= bytes.len() || !bytes[end].is_ascii_alphanumeric();
            if before_ok && after_ok {
                hits.push((word, start));
            }
            from = start + 1;
        }
    }
    // The earliest non-negated hit is the text request to refuse.
    hits.sort_by_key(|(_, index)| *index);
    for (word, index) in hits {
        if negated(prompt, index) {
            continue;
        }
        return Some(format!(
            "Refused: the image model cannot render text. The prompt requested '{}'. \
Describe only graphics, illustration, or logos. If the design needs text, place it with the \
place_object tool and let the app render it.",
            word
        ));
    }
    None
}

/// True when the prompt negates a text request, for example
/// "without text" or "no title".
fn negated(text: &str, index: usize) -> bool {
    let start = index.saturating_sub(32);
    let window = text[start..index].to_lowercase();
    window.contains("no ") || window.contains("without ") || window.contains("avoid ")
}

/// Keywords that signal a request for text in an image prompt.
const TEXT_KEYWORDS: &[&str] = &[
    "text", "title", "headline", "heading", "caption", "slogan", "tagline",
    "motto", "typography", "font", "lettering", "word", "words", "sentence",
    "phrase", "paragraph", "quote", "quotes", "write", "written",
    "writing", "spell", "spelling", "watermark", "inscription", "label",
    "labels", "calligraphy", "letter", "letters",
];

/// Arguments for the place_object tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceObjectArgs {
    pub kind: String,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub font_size: Option<f64>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub fill: Option<String>,
    #[serde(default)]
    pub stroke: Option<String>,
    #[serde(default)]
    pub stroke_width: Option<f64>,
    #[serde(default)]
    pub corner_radius: Option<f64>,
    #[serde(default)]
    pub rotation: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveObjectArgs {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteObjectArgs {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateObjectArgs {
    pub id: String,
    pub degrees: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditObjectPropertyArgs {
    pub id: String,
    pub property: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageArgs {
    pub prompt: String,
}

/// The typed arguments of one tool call.
#[derive(Debug, Clone)]
pub enum ToolCallArgs {
    PlaceObject(PlaceObjectArgs),
    MoveObject(MoveObjectArgs),
    DeleteObject(DeleteObjectArgs),
    RotateObject(RotateObjectArgs),
    EditObjectProperty(EditObjectPropertyArgs),
    GenerateImage(GenerateImageArgs),
}

/// Parse the JSON arguments of a tool call into typed arguments.
pub fn parse_tool_call(name: &str, arguments: &str) -> Result<ToolCallArgs> {
    let bad = |err: serde_json::Error| {
        ImageCoreError::Message(format!("invalid arguments for {name}: {err}"))
    };
    match name {
        "place_object" => serde_json::from_str(arguments)
            .map(ToolCallArgs::PlaceObject)
            .map_err(bad),
        "move_object" => serde_json::from_str(arguments)
            .map(ToolCallArgs::MoveObject)
            .map_err(bad),
        "delete_object" => serde_json::from_str(arguments)
            .map(ToolCallArgs::DeleteObject)
            .map_err(bad),
        "rotate_object" => serde_json::from_str(arguments)
            .map(ToolCallArgs::RotateObject)
            .map_err(bad),
        "edit_object_property" => serde_json::from_str(arguments)
            .map(ToolCallArgs::EditObjectProperty)
            .map_err(bad),
        "generate_image" => serde_json::from_str(arguments)
            .map(ToolCallArgs::GenerateImage)
            .map_err(bad),
        _ => Err(ImageCoreError::Message(format!("unknown tool: {name}"))),
    }
}

fn finite(value: f64) -> bool {
    value.is_finite()
}

fn valid_hex_color(value: &str) -> bool {
    let hex = value.trim().trim_start_matches('#');
    let valid = match hex.len() {
        6 | 8 => hex
            .chars()
            .all(|c| c.is_ascii_hexdigit()),
        _ => false,
    };
    if !valid {
        return false;
    }
    u64::from_str_radix(hex, 16).is_ok()
}

/// The blend modes a layer supports.
pub const BLEND_MODES: &[&str] = &[
    "source-over",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "difference",
    "exclusion",
];

fn invalid(message: impl Into<String>) -> ImageCoreError {
    ImageCoreError::Message(message.into())
}

/// Validate the arguments of one parsed tool call against the poster size.
pub fn validate_tool_call(
    call: &ToolCallArgs,
    poster_width: f64,
    poster_height: f64,
) -> Result<()> {
    match call {
        ToolCallArgs::PlaceObject(args) => validate_place_object(args)?,
        ToolCallArgs::MoveObject(args) => {
            if args.id.trim().is_empty() {
                return Err(invalid("move_object: id is empty"));
            }
            if !finite(args.x) || !finite(args.y) {
                return Err(invalid("move_object: x and y must be numbers"));
            }
        }
        ToolCallArgs::DeleteObject(args) => {
            if args.id.trim().is_empty() {
                return Err(invalid("delete_object: id is empty"));
            }
        }
        ToolCallArgs::RotateObject(args) => {
            if args.id.trim().is_empty() {
                return Err(invalid("rotate_object: id is empty"));
            }
            if !finite(args.degrees) {
                return Err(invalid("rotate_object: degrees must be a number"));
            }
        }
        ToolCallArgs::EditObjectProperty(args) => {
            if args.id.trim().is_empty() {
                return Err(invalid("edit_object_property: id is empty"));
            }
            validate_edit_property(&args.property, &args.value)?;
        }
        ToolCallArgs::GenerateImage(args) => {
            if args.prompt.trim().is_empty() {
                return Err(invalid("generate_image: prompt is empty"));
            }
            if let Some(refusal) = text_request_refusal(&args.prompt) {
                return Err(invalid(refusal));
            }
        }
    }
    // Placed content must stay near the canvas so the agent does not
    // lose objects off-screen.
    if let ToolCallArgs::PlaceObject(args) = call {
        let far = 4.0 * poster_width.max(poster_height);
        if args.x.abs() > far || args.y.abs() > far {
            return Err(invalid("place_object: position is far outside the poster"));
        }
    }
    Ok(())
}

fn validate_place_object(args: &PlaceObjectArgs) -> Result<()> {
    if !finite(args.x) || !finite(args.y) {
        return Err(invalid("place_object: x and y must be numbers"));
    }
    if let Some(value) = args.rotation {
        if !finite(value) {
            return Err(invalid("place_object: rotation must be a number"));
        }
    }
    match args.kind.as_str() {
        "text" => {
            let content = args.content.as_deref().unwrap_or("");
            if content.trim().is_empty() {
                return Err(invalid("place_object: text needs a content value"));
            }
            if let Some(size) = args.font_size {
                if !finite(size) || size <= 0.0 {
                    return Err(invalid("place_object: fontSize must be positive"));
                }
            }
            if let Some(color) = &args.color {
                if !valid_hex_color(color) {
                    return Err(invalid("place_object: color must be #rrggbb or #rrggbbaa"));
                }
            }
            if args.fill.is_some() || args.stroke.is_some() {
                return Err(invalid("place_object: text objects have no fill or stroke"));
            }
        }
        "rect" | "ellipse" => {
            let width = args
                .width
                .ok_or_else(|| invalid("place_object: shapes need a width"))?;
            let height = args
                .height
                .ok_or_else(|| invalid("place_object: shapes need a height"))?;
            if !finite(width) || width <= 0.0 || !finite(height) || height <= 0.0 {
                return Err(invalid("place_object: width and height must be positive"));
            }
            if args.content.is_some() {
                return Err(invalid("place_object: shapes have no text content"));
            }
            for color in [&args.fill, &args.stroke] {
                if let Some(value) = color {
                    if !valid_hex_color(value) {
                        return Err(invalid("place_object: fill and stroke must be #rrggbb or #rrggbbaa"));
                    }
                }
            }
            if let Some(width) = args.stroke_width {
                if !finite(width) || width < 0.0 {
                    return Err(invalid("place_object: strokeWidth must be zero or positive"));
                }
            }
            if let Some(radius) = args.corner_radius {
                if !finite(radius) || radius < 0.0 {
                    return Err(invalid("place_object: cornerRadius must be zero or positive"));
                }
            }
        }
        "line" => {
            let width = args
                .width
                .ok_or_else(|| invalid("place_object: lines need a width"))?;
            let height = args
                .height
                .ok_or_else(|| invalid("place_object: lines need a height"))?;
            if !finite(width) || width == 0.0 || !finite(height) || height == 0.0 {
                return Err(invalid(
                    "place_object: line width and height must be non-zero",
                ));
            }
            if args.content.is_some() || args.fill.is_some() {
                return Err(invalid("place_object: lines have no content or fill"));
            }
            if let Some(value) = &args.stroke {
                if !valid_hex_color(value) {
                    return Err(invalid("place_object: stroke must be #rrggbb or #rrggbbaa"));
                }
            }
        }
        _ => return Err(invalid("place_object: unknown kind")),
    }
    Ok(())
}

fn validate_edit_property(property: &str, value: &serde_json::Value) -> Result<()> {
    let numeric = |value: &serde_json::Value| match value.as_f64() {
        Some(number) if number.is_finite() => Ok(()),
        _ => Err(invalid("edit_object_property: value must be a number")),
    };
    match property {
        "x" | "y" | "width" | "height" | "rotation" | "fontSize"
        | "strokeWidth" | "cornerRadius" => numeric(value),
        "opacity" => match value.as_f64() {
            Some(number) if (0.0..=1.0).contains(&number) => Ok(()),
            _ => Err(invalid("edit_object_property: opacity must be between 0 and 1")),
        },
        "visible" => {
            if value.is_boolean() {
                Ok(())
            } else {
                Err(invalid("edit_object_property: visible must be a boolean"))
            }
        }
        "text" | "color" | "fill" | "stroke" => {
            if value.is_string() {
                Ok(())
            } else {
                Err(invalid("edit_object_property: value must be a string"))
            }
        }
        "blendMode" => match value.as_str() {
            Some(mode) if BLEND_MODES.contains(&mode) => Ok(()),
            _ => Err(invalid("edit_object_property: unknown blend mode")),
        },
        _ => Err(invalid(format!("edit_object_property: unknown property '{property}'"))),
    }
}

/// Call the chat-completions endpoint and return the model's answer.
pub async fn complete(
    config: &CompletionSettings,
    mut request: ChatCompletionRequest,
) -> Result<ChatCompletionResponse> {
    let model = config.model.trim();
    if model.is_empty() {
        return Err(invalid("completion model is not configured"));
    }
    // The configured model always wins over whatever the caller set.
    request.model = model.to_string();
    let client = http_client()?;
    let url = format!(
        "{}/chat/completions",
        config.base_url.trim_end_matches('/')
    );
    let builder = client.post(&url);
    let builder = if config.api_key.trim().is_empty() {
        builder
    } else {
        builder.bearer_auth(config.api_key.trim())
    };
    let response = builder
        .json(&request)
        .send()
        .await
        .map_err(|err| invalid(format!("completion request failed: {err}")))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(invalid(format!(
            "completion API returned {status}: {text}"
        )));
    }
    response
        .json()
        .await
        .map_err(|err| invalid(format!("bad completion response: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn poster() -> (f64, f64) {
        (1024.0, 1536.0)
    }

    #[test]
    fn tool_definitions_expose_all_six_tools() {
        let tools = tool_definitions();
        assert_eq!(tools.len(), 6);
        let names: Vec<&str> = tools
            .iter()
            .filter_map(|tool| tool["function"]["name"].as_str())
            .collect();
        for expected in [
            "place_object",
            "move_object",
            "delete_object",
            "rotate_object",
            "edit_object_property",
            "generate_image",
        ] {
            assert!(names.contains(&expected), "missing tool {expected}");
        }
        for tool in &tools {
            let parameters = &tool["function"]["parameters"];
            assert!(parameters["type"] == "object");
            assert!(!parameters["properties"].is_null());
        }
    }

    #[test]
    fn system_prompt_forbids_text_in_images() {
        let prompt = system_prompt(800.0, 600.0);
        assert!(prompt.contains("800"));
        assert!(prompt.contains("600"));
        assert!(prompt.contains("CANNOT generate text"));
        assert!(prompt.contains("place_object"));
        assert!(prompt.contains("generate_image"));
        // The agent must not escape plain ampersands as HTML entities.
        assert!(prompt.contains("&amp;"));
        assert!(prompt.contains("literal ampersand"));
    }

    #[test]
    fn guardrail_accepts_graphics_only_prompts() {
        for prompt in [
            "a mountain landscape at sunset",
            "abstract flowing shapes in blue and gold",
            "a minimal logo mark of a bird",
            "an illustrated tropical plant in a pot",
        ] {
            assert!(
                text_request_refusal(prompt).is_none(),
                "graphics prompt rejected: {prompt}"
            );
        }
    }

    #[test]
    fn guardrail_rejects_text_requests() {
        for prompt in [
            "a poster with the title 'SUMMER'",
            "red bold text saying hello",
            "add a caption at the bottom",
            "write the word freedom across it",
            "big headline typography",
            "a label on the jar",
            "letters spelling FEST",
            "a slogan in italic",
        ] {
            assert!(
                text_request_refusal(prompt).is_some(),
                "text prompt accepted: {prompt}"
            );
        }
    }

    #[test]
    fn guardrail_allows_negated_mentions() {
        for prompt in [
            "an abstract background without any text",
            "no text, just shapes",
            "geometric pattern with no words",
        ] {
            assert!(
                text_request_refusal(prompt).is_none(),
                "negated text mention rejected: {prompt}"
            );
        }
    }

    #[test]
    fn guardrail_ignores_texture() {
        assert!(text_request_refusal("a textured wall").is_none());
        assert!(text_request_refusal("textured paper background").is_none());
    }

    #[test]
    fn parse_tool_call_accepts_all_six_tools() {
        let cases = [
            (
                "place_object",
                r#"{"kind":"rect","x":10,"y":20,"width":100,"height":50}"#,
            ),
            (
                "place_object",
                r#"{"kind":"text","x":10,"y":20,"content":"Hello","fontSize":40}"#,
            ),
            (
                "move_object",
                r#"{"id":"l1","x":5,"y":5}"#,
            ),
            (
                "delete_object",
                r#"{"id":"l1"}"#,
            ),
            (
                "rotate_object",
                r#"{"id":"l1","degrees":45}"#,
            ),
            (
                "edit_object_property",
                r#"{"id":"l1","property":"opacity","value":0.5}"#,
            ),
            (
                "generate_image",
                r#"{"prompt":"a city skyline at dusk"}"#,
            ),
        ];
        for (name, arguments) in cases {
            assert!(parse_tool_call(name, arguments).is_ok(), "{name}: {arguments}");
        }
    }

    #[test]
    fn parse_tool_call_rejects_bad_input() {
        assert!(parse_tool_call("place_object", "not json").is_err());
        assert!(parse_tool_call("place_object", r#"{"kind":"rect"}"#).is_err());
        assert!(parse_tool_call("unknown_tool", "{}").is_err());
        assert!(
            parse_tool_call("generate_image", r#"{"prompt":"x"}"#).is_ok()
        );
    }

    #[test]
    fn validate_place_object_rules() {
        let (w, h) = poster();
        let ok = ToolCallArgs::PlaceObject(PlaceObjectArgs {
            kind: "rect".into(),
            x: 100.0,
            y: 200.0,
            width: Some(50.0),
            height: Some(30.0),
            content: None,
            font_size: None,
            color: None,
            fill: Some("#ff0000".into()),
            stroke: Some("#000000aa".into()),
            stroke_width: Some(2.0),
            corner_radius: Some(8.0),
            rotation: Some(90.0),
        });
        assert!(validate_tool_call(&ok, w, h).is_ok());

        let bad_kind = ToolCallArgs::PlaceObject(PlaceObjectArgs {
            kind: "polygon".into(),
            x: 0.0,
            y: 0.0,
            width: Some(10.0),
            height: Some(10.0),
            content: None,
            font_size: None,
            color: None,
            fill: None,
            stroke: None,
            stroke_width: None,
            corner_radius: None,
            rotation: None,
        });
        assert!(validate_tool_call(&bad_kind, w, h).is_err());
        let rect_no_size = ToolCallArgs::PlaceObject(PlaceObjectArgs {
            kind: "rect".into(),
            x: 0.0,
            y: 0.0,
            width: None,
            height: None,
            content: None,
            font_size: None,
            color: None,
            fill: None,
            stroke: None,
            stroke_width: None,
            corner_radius: None,
            rotation: None,
        });
        assert!(validate_tool_call(&rect_no_size, w, h).is_err());

        let text_no_content = ToolCallArgs::PlaceObject(PlaceObjectArgs {
            kind: "text".into(),
            x: 0.0,
            y: 0.0,
            width: None,
            height: None,
            content: Some("   ".into()),
            font_size: None,
            color: None,
            fill: None,
            stroke: None,
            stroke_width: None,
            corner_radius: None,
            rotation: None,
        });
        assert!(validate_tool_call(&text_no_content, w, h).is_err());

        let line_negative_run = ToolCallArgs::PlaceObject(PlaceObjectArgs {
            kind: "line".into(),
            x: 100.0,
            y: 100.0,
            width: Some(-40.0),
            height: Some(20.0),
            content: None,
            font_size: None,
            color: None,
            fill: None,
            stroke: Some("#111111".into()),
            stroke_width: Some(3.0),
            corner_radius: None,
            rotation: None,
        });
        assert!(validate_tool_call(&line_negative_run, w, h).is_ok());

        let bad_color = ToolCallArgs::PlaceObject(PlaceObjectArgs {
            kind: "rect".into(),
            x: 0.0,
            y: 0.0,
            width: Some(10.0),
            height: Some(10.0),
            content: None,
            font_size: None,
            color: None,
            fill: Some("not-a-color".into()),
            stroke: None,
            stroke_width: None,
            corner_radius: None,
            rotation: None,
        });
        assert!(validate_tool_call(&bad_color, w, h).is_err());
    }

    #[test]
    fn validate_edit_property_rules() {
        let (w, h) = poster();
        let opacity = ToolCallArgs::EditObjectProperty(EditObjectPropertyArgs {
            id: "l1".into(),
            property: "opacity".into(),
            value: serde_json::json!(0.5),
        });
        assert!(validate_tool_call(&opacity, w, h).is_ok());

        let opacity_out_of_range =
            ToolCallArgs::EditObjectProperty(EditObjectPropertyArgs {
                id: "l1".into(),
                property: "opacity".into(),
                value: serde_json::json!(1.5),
            });
        assert!(validate_tool_call(&opacity_out_of_range, w, h).is_err());

        let unknown = ToolCallArgs::EditObjectProperty(EditObjectPropertyArgs {
            id: "l1".into(),
            property: "sparkles".into(),
            value: serde_json::json!(1),
        });
        assert!(validate_tool_call(&unknown, w, h).is_err());

        let bad_blend = ToolCallArgs::EditObjectProperty(EditObjectPropertyArgs {
            id: "l1".into(),
            property: "blendMode".into(),
            value: serde_json::json!("neon"),
        });
        assert!(validate_tool_call(&bad_blend, w, h).is_err());
    }

    #[test]
    fn validate_generate_image_guardrail_returns_error() {
        let (w, h) = poster();
        let text_prompt = ToolCallArgs::GenerateImage(GenerateImageArgs {
            prompt: "a beach with the text SURF".into(),
        });
        let error = validate_tool_call(&text_prompt, w, h).unwrap_err();
        let message = error.to_string();
        assert!(message.contains("Refused"), "{message}");
    }

    #[test]
    fn request_serializes_messages_and_tools() {
        let request = ChatCompletionRequest {
            model: "agent-model".into(),
            messages: vec![
                ChatMessage {
                    role: "system".into(),
                    content: "you are the agent".into(),
                    tool_calls: None,
                    tool_call_id: None,
                },
                ChatMessage {
                    role: "user".into(),
                    content: "make a poster".into(),
                    tool_calls: None,
                    tool_call_id: None,
                },
            ],
            tools: tool_definitions(),
            tool_choice: Some("auto".into()),
            temperature: Some(0.7),
        };
        let json = serde_json::to_value(&request).unwrap();
        assert_eq!(json["model"], "agent-model");
        assert_eq!(json["messages"][0]["role"], "system");
        assert_eq!(json["messages"][1]["content"], "make a poster");
        assert_eq!(json["tools"].as_array().unwrap().len(), 6);
        assert_eq!(json["tool_choice"], "auto");
        assert_eq!(json["temperature"], 0.7);
        assert!(!json["messages"][0].as_object().unwrap().contains_key("tool_calls"));
        assert!(!json["messages"][0].as_object().unwrap().contains_key("tool_call_id"));
    }

    #[test]
    fn place_object_off_canvas_is_rejected() {
        let (w, h) = poster();
        let far = ToolCallArgs::PlaceObject(PlaceObjectArgs {
            kind: "rect".into(),
            x: 50000.0,
            y: 0.0,
            width: Some(10.0),
            height: Some(10.0),
            content: None,
            font_size: None,
            color: None,
            fill: None,
            stroke: None,
            stroke_width: None,
            corner_radius: None,
            rotation: None,
        });
        assert!(validate_tool_call(&far, w, h).is_err());
    }
}
