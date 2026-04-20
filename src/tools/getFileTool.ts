export const GET_FILES_TOOL = {
  name: 'yoink-get-files',
  displayName: 'Yoink: Get Files',
  description:
    'Fetch the complete content of one or more text files from indexed GitHub repositories in a single call. ' +
    'Pass up to 10 files. Each file is returned in full — no pagination needed. ' +
    'Individual files that are binary or over 500 KB return an error entry; the rest still succeed. ' +
    'Use startLine/endLine per file only when you need a specific section. ' +
    'Total response is capped at 2 MB across all files.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      files: {
        type: 'array' as const,
        minItems: 1,
        maxItems: 10,
        description: 'Files to fetch. Maximum 10 per call.',
        items: {
          type: 'object' as const,
          properties: {
            repository: {
              type: 'string' as const,
              description: "Indexed repository in 'owner/repo' format (e.g. 'vercel/next.js').",
            },
            filePath: {
              type: 'string' as const,
              description: 'Path to the file within the repository.',
            },
            startLine: {
              type: 'number' as const,
              description: 'Optional. First line to return (1-indexed).',
            },
            endLine: {
              type: 'number' as const,
              description: 'Optional. Last line to return (1-indexed).',
            },
          },
          required: ['repository', 'filePath'],
        },
      },
    },
    required: ['files'],
  },
};
