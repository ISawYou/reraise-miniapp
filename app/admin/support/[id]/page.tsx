"use client";
import {useParams} from "next/navigation";
import {SupportChat} from "@/components/support/support-chat";
export default function StaffSupportPage(){const {id}=useParams<{id:string}>();return <SupportChat key={id} threadId={id}/>;}
