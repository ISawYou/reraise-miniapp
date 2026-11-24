"use client";
import { useState } from "react";
import Image from "next/image";
import {
  getDefaultTournamentVisual,
  type TournamentVisualConfig,
} from "@/config/tournament-visuals";
import type { GuideArticle } from "./content";

export function artworkSources(
  article: GuideArticle,
  visuals: TournamentVisualConfig[],
) {
  // Monthly final is an is_final Classic event, not a separate TournamentType.
  const type =
    article.format === "monthly-final" ? "classic" : article.format;
  if (!type) return [];
  const defaults = getDefaultTournamentVisual(type);
  const stored = visuals.find((v) => v.tournamentType === type);
  return [
    ...new Set(
      [
        stored?.cardAssetUrl,
        stored?.assetUrl,
        defaults.cardAssetUrl,
        defaults.assetUrl,
      ].filter((s): s is string => !!s),
    ),
  ];
}
export function Artwork({
  article,
  visuals,
}: {
  article: GuideArticle;
  visuals: TournamentVisualConfig[];
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const src = artworkSources(article, visuals).find((s) => !failed.includes(s));
  return (
    <div className="guide-art" aria-hidden="true">
      {src ? (
        <Image
          unoptimized
          loading="eager"
          src={src}
          alt=""
          width={160}
          height={160}
          onError={() => setFailed((prev) => [...prev, src])}
        />
      ) : (
        <span>
          {article.title
            .split(/\s+/)
            .map((w) => w[0])
            .slice(0, 3)
            .join("")}
        </span>
      )}
    </div>
  );
}
