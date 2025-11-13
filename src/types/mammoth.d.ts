declare module 'mammoth' {
  export interface ExtractRawTextResult {
    value?: string;
    messages?: Array<{ type: string; message: string }>;
  }

  export interface ExtractRawTextOptions {
    arrayBuffer: ArrayBuffer;
  }

  export function extractRawText(options: ExtractRawTextOptions): Promise<ExtractRawTextResult>;
}
