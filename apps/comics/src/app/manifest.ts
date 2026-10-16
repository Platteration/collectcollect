import type { MetadataRoute } from "next";
import { domainManifest } from "@collectcollect/core/domain/pwa";
import { engine } from "@/lib/engine";

export default function manifest(): MetadataRoute.Manifest {
  return domainManifest(engine.spec);
}
