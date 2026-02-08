// CodeMirror 6 entry point - exports everything needed as window.CM
export { EditorState } from '@codemirror/state';
export { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
export { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
export { markdown, markdownLanguage } from '@codemirror/lang-markdown';
export { syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap, defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
export { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
export { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
export { tags } from '@lezer/highlight';
