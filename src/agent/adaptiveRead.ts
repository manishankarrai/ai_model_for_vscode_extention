export interface BoundedTextChunk {
  content: string;
  nextOffset: number;
  chars: number;
  startLine: number;
  endLine: number;
  totalLines: number;
  remainingLines: number;
  hasMore: boolean;
}

function lineCount(content: string): number {
  if (!content) {
    return 0;
  }
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

function lineStartOffset(content: string, line: number): number {
  if (line <= 1) {
    return 0;
  }

  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const newline = content.indexOf("\n", offset);
    if (newline < 0) {
      return content.length;
    }
    offset = newline + 1;
  }
  return offset;
}

function lineAtOffset(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (content[index] === "\n") {
      line += 1;
    }
  }
  return line;
}

export function readBoundedTextChunk(
  content: string,
  offset: number,
  maxChars: number,
  maxLines: number,
  requestedStartLine?: number,
  requestedEndLine?: number
): BoundedTextChunk {
  const totalLines = lineCount(content);
  const initialOffset = requestedStartLine !== undefined
    ? lineStartOffset(content, Math.max(1, requestedStartLine))
    : Math.min(Math.max(0, offset), content.length);
  const safeOffset = Math.min(initialOffset, content.length);
  const startLine = content ? lineAtOffset(content, safeOffset) : 0;
  const rangeEndOffset = requestedEndLine !== undefined
    ? lineStartOffset(content, Math.max(startLine, requestedEndLine + 1))
    : content.length;
  const boundedEndOffset = Math.max(safeOffset, Math.min(rangeEndOffset, content.length));
  const lineLimitEndOffset = maxLines > 0
    ? lineStartOffset(content, startLine + maxLines)
    : safeOffset;
  const hardEnd = Math.min(
    safeOffset + Math.max(1, maxChars),
    boundedEndOffset,
    lineLimitEndOffset
  );

  let nextOffset = hardEnd;
  if (nextOffset < boundedEndOffset) {
    const newline = content.lastIndexOf("\n", nextOffset - 1);
    if (newline >= safeOffset) {
      nextOffset = newline + 1;
    }
  }
  if (nextOffset <= safeOffset && safeOffset < boundedEndOffset) {
    nextOffset = hardEnd;
  }

  const chunk = content.slice(safeOffset, nextOffset);
  const endLine = chunk
    ? lineAtOffset(content, Math.max(safeOffset, nextOffset - (chunk.endsWith("\n") ? 1 : 0)))
    : startLine;
  const hasMore = nextOffset < boundedEndOffset;

  return {
    content: chunk,
    nextOffset,
    chars: chunk.length,
    startLine,
    endLine,
    totalLines,
    remainingLines: Math.max(0, totalLines - endLine),
    hasMore
  };
}