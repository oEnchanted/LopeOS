/** Qwen3 can emit an empty thinking wrapper even when thinking is disabled. */
export function createResponseFilter() {
  let buffer = '', decided = false, trimAfterWrapper = false;
  return {
    push(text: string) {
      if (decided) return text;
      if (trimAfterWrapper) {
        const content = text.trimStart();
        if (content) decided = true;
        return content;
      }
      buffer += text;
      const complete = /^\s*<think>\s*<\/think>\s*/.exec(buffer);
      if (complete) {
        const content = buffer.slice(complete[0].length);
        buffer = ''; trimAfterWrapper = true; decided = !!content;
        return content;
      }
      const candidate = buffer.trimStart();
      if ('<think>'.startsWith(candidate)) return '';
      if (candidate.startsWith('<think>') && '</think>'.startsWith(candidate.slice(7).trimStart())) return '';
      decided = true;
      const content = buffer; buffer = '';
      return content;
    },
    finish() { const content = buffer; buffer = ''; decided = true; return content; },
  };
}
