const parser = Promise.all([
  import('mdast-util-from-markdown'),
  import('mdast-util-gfm'),
  import('micromark-extension-gfm'),
  import('micromark-util-decode-string')
]).then(([{ fromMarkdown }, { gfmFromMarkdown }, { gfm }, { decodeString }]) => {
  const options = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] };
  return (text, offsets = false) => {
    const source = String(text ?? '').replace(/\r\n?/g, '\n');
    return render(fromMarkdown(source, options), source, offsets, decodeString);
  };
});

const escape = text => text.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function safeHref(value) {
  if (value.startsWith('#')) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function render(tree, source, offsets, decodeString) {
  const definitions = new Map();
  function readDefinitions(node) {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    for (const child of node.children || []) readDefinitions(child);
  }
  readDefinitions(tree);

  function span(value, start, end) {
    return '<span data-source-start="' + start + '" data-source-end="' + end + '">' + escape(value) + '</span>';
  }

  function content(value, node, literal = false) {
    if (!value || !offsets || !node.position) return escape(value);
    let left = node.position.start.offset;
    let right = node.position.end.offset;
    if (node.type === 'code') {
      const fence = /^(?:\x60{3,}|~{3,})[^\n]*\n/.exec(source.slice(left, right));
      left += fence ? fence[0].length : 0;
    } else if (node.type === 'inlineCode') {
      const fence = /^\x60+/.exec(source.slice(left, right))[0].length;
      left += fence;
      right -= fence;
    }
    const direct = source.indexOf(value, left);
    if (direct !== -1 && direct + value.length <= right && (literal || right - left === value.length)) {
      return span(value, direct, direct + value.length);
    }

    const parts = [];
    let start = left;
    let cursor = 0;
    while (cursor < value.length && start < right) {
      const raw = source[start];
      const encoded = !literal && (raw === '&' || raw === '\\')
        ? /^(?:\\[!-/:-@\[-\x60{-~]|&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);)/.exec(source.slice(start, right))?.[0]
        : null;
      const decoded = encoded ? decodeString(encoded) : raw === '\n' && node.type === 'inlineCode' ? ' ' : raw;
      if (value.startsWith(decoded, cursor)) {
        const end = start + (encoded?.length || 1);
        const last = parts.at(-1);
        if (last && last.end === start && last.value.length === last.end - last.start && decoded.length === end - start) {
          last.value += decoded;
          last.end = end;
        } else {
          parts.push({ value: decoded, start, end });
        }
        cursor += decoded.length;
        start = end;
      } else {
        start++;
      }
    }
    if (cursor < value.length) return span(value, left, right);
    return parts.map(part => span(part.value, part.start, part.end)).join('');
  }

  function link(url, label) {
    const href = safeHref(url || '');
    return href ? '<a href="' + escape(href) + '" rel="noreferrer noopener">' + label + '</a>' : label;
  }

  function element(node) {
    const children = () => (node.children || []).map(element).join('');
    const tag = name => '<' + name + '>' + children() + '</' + name + '>';
    switch (node.type) {
      case 'root': return children();
      case 'paragraph': return tag('p');
      case 'heading': return tag('h' + node.depth);
      case 'strong': return tag('strong');
      case 'emphasis': return tag('em');
      case 'delete': return tag('del');
      case 'blockquote': return tag('blockquote');
      case 'thematicBreak': return '<hr>';
      case 'break': return '<br>';
      case 'text': return content(node.value, node);
      case 'html': return content(node.value, node, true);
      case 'inlineCode': return '<code>' + content(node.value, node, true) + '</code>';
      case 'code': return '<pre><code>' + content(node.value, node, true) + '</code></pre>';
      case 'link': return link(node.url, children());
      case 'linkReference': return link(definitions.get(node.identifier), children());
      case 'image': return link(node.url, content(node.alt || '', node));
      case 'imageReference': return link(definitions.get(node.identifier), content(node.alt || '', node));
      case 'list':
        if (!node.ordered) return tag('ul');
        return '<ol start="' + node.start + '">' + children() + '</ol>';
      case 'listItem': return '<li>' +
        (typeof node.checked === 'boolean' ? '<input type="checkbox" disabled' + (node.checked ? ' checked' : '') + '>' : '') +
        children() + '</li>';
      case 'table': {
        const [header, ...body] = node.children;
        const row = (item, name) => '<tr>' + item.children.map((cell, index) => {
          const alignment = node.align[index];
          return '<' + name + (alignment ? ' class="align-' + alignment + '"' : '') + '>' +
            cell.children.map(element).join('') + '</' + name + '>';
        }).join('') + '</tr>';
        return '<div class="feedback-table-scroll"><table><thead>' + row(header, 'th') +
          '</thead><tbody>' + body.map(item => row(item, 'td')).join('') + '</tbody></table></div>';
      }
      case 'footnoteReference': return '<sup>' + content('[' + node.identifier + ']', node) + '</sup>';
      case 'footnoteDefinition': return tag('aside');
      default: return children();
    }
  }

  return element(tree);
}

module.exports = { parser };
