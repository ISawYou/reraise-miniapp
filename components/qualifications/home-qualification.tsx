"use client";
import { useEffect,useState } from "react";
import { QualificationHomeCard } from "./qualification-view";
export function HomeQualification(){const [events,setEvents]=useState<{slug:string;title:string;bestResultsCount:number}[]>([]);useEffect(()=>{let live=true;fetch("/api/qualifications").then(r=>r.ok?r.json():Promise.reject()).then(data=>{if(live)setEvents(data.events??[]);}).catch(()=>{});return()=>{live=false;};},[]);return events.map(event=><QualificationHomeCard key={event.slug} {...event}/>);}
