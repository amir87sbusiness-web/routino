declare module "jsdom" {
  interface ElementLike {
    textContent?: string | null;
  }

  interface JSDOMOptions {
    runScripts?: "dangerously";
    url?: string;
    beforeParse?: (window: object) => void;
  }

  export class JSDOM {
    constructor(html: string, options?: JSDOMOptions);
    window: {
      document: { querySelector: (selector: string) => ElementLike | null };
      close: () => void;
    };
  }
}
