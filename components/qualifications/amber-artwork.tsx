"use client";

import { useId } from "react";

// Original decorative vector composition. The spade is a poker motif, not a
// replacement official club logo. No photographs, mockups or external assets.
export function AmberArtwork({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} viewBox="0 0 360 300" fill="none" aria-hidden="true" focusable="false" data-amber-artwork="">
      <defs>
        <radialGradient id={`${id}-light`}><stop stopColor="#F1A52C" stopOpacity=".32"/><stop offset="1" stopColor="#C88719" stopOpacity="0"/></radialGradient>
        <linearGradient id={`${id}-rim`} x1="150" y1="30" x2="290" y2="235" gradientUnits="userSpaceOnUse"><stop stopColor="#FFF1B1"/><stop offset=".2" stopColor="#E9B654"/><stop offset=".48" stopColor="#8C430E"/><stop offset=".73" stopColor="#FFD785"/><stop offset="1" stopColor="#A85912"/></linearGradient>
        <radialGradient id={`${id}-amber`} cx=".35" cy=".25" r=".9"><stop stopColor="#FFC663" stopOpacity=".92"/><stop offset=".35" stopColor="#D58419" stopOpacity=".76"/><stop offset=".7" stopColor="#713608" stopOpacity=".92"/><stop offset="1" stopColor="#E9AB36"/></radialGradient>
        <linearGradient id={`${id}-facet`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#FFE4A0" stopOpacity=".9"/><stop offset=".5" stopColor="#CB710E" stopOpacity=".7"/><stop offset="1" stopColor="#542904" stopOpacity=".95"/></linearGradient>
      </defs>
      <ellipse cx="239" cy="178" rx="145" ry="120" fill={`url(#${id}-light)`}/>
      <g stroke="#E9B654" strokeWidth=".65" opacity=".19">
        {Array.from({length:8},(_,i)=><path key={i} d={`M-40 ${267+i*4}C65 ${205+i*5} 100 ${324+i*3} 219 ${252+i*4}S332 ${214+i*5} 400 ${241+i*4}`}/>)}
      </g>
      <ellipse cx="244" cy="253" rx="99" ry="17" fill="#030B07" opacity=".65"/>
      <g transform="rotate(24 235 146)">
        <ellipse cx="245" cy="158" rx="77" ry="99" fill="#653309" stroke="#BA721E" strokeWidth="3"/>
        <ellipse cx="235" cy="146" rx="78" ry="99" fill={`url(#${id}-rim)`}/>
        <ellipse cx="235" cy="146" rx="71" ry="91" fill={`url(#${id}-amber)`} stroke="#FFE9A3" strokeOpacity=".7" strokeWidth="1.5"/>
        <ellipse cx="235" cy="146" rx="65" ry="84" stroke="#FFDA7B" strokeWidth="7" strokeDasharray="13 15" opacity=".75"/>
        <ellipse cx="235" cy="146" rx="54" ry="72" fill="#8F4B0C" fillOpacity=".28" stroke="#FFE1A0" strokeOpacity=".6"/>
        <path d="M183 150 205 94 250 65 226 111 196 181Z" fill="#FFF0BB" opacity=".13"/>
        <path d="m272 131-17 36 6 40-35 20 44-8 27-50Z" fill="#6E2C00" opacity=".28"/>
        <path d="M236 113c-8 11-27 23-27 40a15 15 0 0 0 27 9 15 15 0 0 0 27-9c0-17-19-29-27-40Z" fill="#F9D181" fillOpacity=".84" stroke="#FFEDB6" strokeWidth="1.5"/>
        <path d="m236 160-9 21h18l-9-21Z" fill="#F9D181"/>
        <path d="M175 142c-4-40 9-68 32-82" stroke="#FFF3C9" strokeWidth="3" strokeLinecap="round" opacity=".7"/>
        <g fill="#FFDA7B" opacity=".55"><circle cx="204" cy="132" r="2"/><circle cx="253" cy="107" r="1.4"/><circle cx="212" cy="185" r="1.2"/><circle cx="268" cy="164" r="2.2"/><circle cx="225" cy="90" r="1"/></g>
      </g>
      <g stroke="#F8CD71" strokeOpacity=".6" strokeWidth=".8">
        <path d="m126 248 26-33 32 7 13 30-33 22-38-9Z" fill={`url(#${id}-facet)`}/><path d="m126 248 39-5 19-21m-32-7 13 28 32 9m-32-9-1 31"/>
        <path d="m276 252 22-34 29 9 14 27-30 22Z" fill={`url(#${id}-facet)`}/><path d="m276 252 35-7 16-18m-29-9 13 27 30 9m-30-9v31"/>
        <path d="m201 270 18-22 28 3 12 22-30 14Z" fill={`url(#${id}-facet)`}/><path d="m201 270 28-6 18-13m-28-3 10 16 30 9m-30-9v23"/>
      </g>
      <g stroke="#FFE3A0" strokeLinecap="round" opacity=".6"><path d="M305 66v10m-5-5h10"/><path d="M143 182v6m-3-3h6"/></g>
    </svg>
  );
}
