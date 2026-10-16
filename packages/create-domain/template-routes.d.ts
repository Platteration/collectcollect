// What `next typegen` writes into an app's .next/types/routes.d.ts, for the
// pages and the layout the template has, so that the template can be
// type-checked where it is: in place, with no app for Next to read. An app
// made from it generates the real declarations; the scaffolder copies only
// template/, so this file never reaches one. A page added to the template is
// added here.

import type { ReactNode } from "react";

type TemplateParams = {
  "/": Record<string, never>;
  "/add": Record<string, never>;
  "/alerts": Record<string, never>;
  "/collection": Record<string, never>;
  "/import": Record<string, never>;
  "/items/[id]": { id: string };
  "/login": Record<string, never>;
  "/report": Record<string, never>;
  "/settings": Record<string, never>;
};

declare global {
  interface PageProps<AppRoute extends keyof TemplateParams> {
    params: Promise<TemplateParams[AppRoute]>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
  type LayoutProps<LayoutRoute extends "/"> = {
    params: Promise<TemplateParams[LayoutRoute]>;
    children: ReactNode;
  };
}

export {};
