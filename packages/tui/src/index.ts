import React from "react";
import { render } from "ink";
import { Root, type RootProps, type Spec } from "./root.js";

export function startTui(props: RootProps): void {
  render(React.createElement(Root, props), { patchConsole: true, exitOnCtrlC: false });
}

export { Root, type RootProps, type Spec } from "./root.js";
export { pickStartingSpec } from "./start.js";
export { App, type AppProps } from "./app.js";
