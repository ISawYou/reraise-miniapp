"use client";

import { useEffect, useState } from "react";
import type { QualificationPublicModel } from "@/types/qualifications";
import { QualificationHomeCard } from "./qualification-view";

type PromoEvent = { slug: string; title: string; bestResultsCount: number; dates?: string[]; finalDate?: string; finalStartAt?:string; timezone?:string };
export function HomeQualification() {
  const [events, setEvents] = useState<PromoEvent[]>([]);
  useEffect(() => {
    let live = true;
    // Eligibility remains the existing public event list. Dates come from the
    // existing detail DTO, never from the visual references or a new API.
    fetch("/api/qualifications").then(response => response.ok ? response.json() : Promise.reject()).then(async data => {
      const listed = (data.events as PromoEvent[] | undefined) ?? [];
      if (live) setEvents(listed);
      const promos = await Promise.all(listed.map(async event => {
        try {
          const response = await fetch(`/api/qualifications/${encodeURIComponent(event.slug)}`);
          if (!response.ok) return event;
          const model = await response.json() as QualificationPublicModel;
          return { ...event, dates: model.schedule.map(slot => slot.scheduledDate), finalDate: model.event.finalDate, finalStartAt:model.finalTournament?.startAt, timezone:model.event.timezone };
        } catch { return event; }
      }));
      if (live) setEvents(promos);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return events.map(event => <QualificationHomeCard key={event.slug} {...event}/>);
}
