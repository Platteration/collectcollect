import { NextResponse } from "next/server";
import { listAlerts, markAllRead, unreadCount } from "@/lib/alerts";

export async function GET() {
  return NextResponse.json({ alerts: listAlerts(), unread: unreadCount() });
}

/** POST — mark everything read. */
export async function POST() {
  return NextResponse.json({ marked: markAllRead(), unread: unreadCount() });
}
