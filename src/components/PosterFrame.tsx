interface PosterFrameProps {
  /** Poster width in pixels. */
  width: number;
  /** Poster height in pixels. */
  height: number;
}

/** Empty poster base canvas frame shown before generation. */
export function PosterFrame({ width, height }: PosterFrameProps) {
  return (
    <div className="poster-frame-wrap" data-testid="poster-frame">
      <canvas
        className="poster-frame"
        width={width}
        height={height}
        role="img"
        aria-label={`Poster base canvas ${width} by ${height} pixels`}
      />
      <span className="poster-frame-dimensions">
        {width} x {height} px
      </span>
    </div>
  );
}
