/** Minimal typings for @novnc/novnc (ships no .d.ts) — only the surface the
 *  VNC panel uses. API reference: node_modules/@novnc/novnc/docs/API.md */
declare module "@novnc/novnc" {
  export interface RFBOptions {
    shared?: boolean;
    credentials?: { username?: string; password?: string; target?: string };
    repeaterID?: string;
    wsProtocols?: string[];
  }

  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket | RTCDataChannel,
      options?: RFBOptions
    );

    viewOnly: boolean;
    focusOnClick: boolean;
    scaleViewport: boolean;
    clipViewport: boolean;
    resizeSession: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;

    disconnect(): void;
    sendCredentials(credentials: {
      username?: string;
      password?: string;
      target?: string;
    }): void;
  }
}
