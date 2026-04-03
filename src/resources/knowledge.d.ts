// Type declarations for markdown file imports (tsup loader: { ".md": "text" })
declare module '*.md' {
  const content: string;
  export default content;
}
