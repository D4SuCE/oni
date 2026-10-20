// Project-specific lint rules (ESLint plugin format, loaded by oxlint via jsPlugins).

const EFFECTS = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect']);

/**
 * `useEffect(() => el.scrollTo(...))` returns whatever the call returns. React treats
 * a returned value as the cleanup function; Chromium's scrollTo() started returning a
 * Promise, and the next unmount crashed the whole UI ("destroy is not a function").
 */
const effectBlockBody = {
  meta: {
    type: 'problem',
    docs: { description: 'Effect callbacks must have a block body so they return nothing or a cleanup function' },
    messages: { expression: 'Wrap the effect body in braces: an expression body returns its value to React as the cleanup.' },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee.type === 'MemberExpression' ? node.callee.property : node.callee;
        if (callee?.type !== 'Identifier' || !EFFECTS.has(callee.name)) return;
        const fn = node.arguments[0];
        if (fn?.type === 'ArrowFunctionExpression' && fn.body.type !== 'BlockStatement') {
          context.report({ node: fn.body, messageId: 'expression' });
        }
      },
    };
  },
};

export default {
  meta: { name: 'wave' },
  rules: { 'effect-block-body': effectBlockBody },
};
