import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddItemFlow } from "../src/components/domain/AddItemFlow";
import type { FieldSpec } from "../src/domain/spec";

const draw = (fields: FieldSpec[]) =>
  renderToStaticMarkup(createElement(AddItemFlow, { fields, noun: { singular: "widget", plural: "widgets" }, canIdentify: false, hasIdentify: false, locations: [] }));

const saveButton = (html: string) => /<button[^>]*class="btn-primary"[^>]*>Save widget<\/button>/.exec(html)?.[0];

const name: FieldSpec = { key: "name", label: "Name", type: "text", required: true };
const maker: FieldSpec = { key: "maker", label: "Maker", type: "text" };

describe("adding one thing", () => {
  it("holds the save button back until the first field, the one that names it, has something in it", () => {
    expect(saveButton(draw([name, maker]))).toContain("disabled");
    expect(saveButton(draw([{ ...name, default: "Gizmo" }, maker]))).not.toContain("disabled");
    // Another field's default does not stand in for the name.
    expect(saveButton(draw([name, { ...maker, default: "Acme" }]))).toContain("disabled");
  });

  it("draws a form with no fields at all, with nothing to save", () => {
    expect(saveButton(draw([]))).toContain("disabled");
  });
});
