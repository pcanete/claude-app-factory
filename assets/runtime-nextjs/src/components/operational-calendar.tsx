"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rescheduleRecordAction } from "@/app/record-operations/actions";

type CalendarCell = { key: string; day: number | null };
type CalendarEvent = { id: string; title: string; dateKey: string; href?: string };

export function OperationalCalendar({
  viewKey, cells, initialEvents, canReschedule,
}: {
  viewKey: string;
  cells: CalendarCell[];
  initialEvents: CalendarEvent[];
  canReschedule: boolean;
}) {
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const days = cells.filter((cell): cell is { key: string; day: number } => cell.day !== null);

  function move(recordId: string, targetDate: string) {
    const event = events.find((candidate) => candidate.id === recordId);
    if (!canReschedule || !event || event.dateKey === targetDate) return;
    startTransition(async () => {
      const result = await rescheduleRecordAction(viewKey, recordId, targetDate);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError("");
      setEvents((current) => current.map((candidate) => candidate.id === recordId ? { ...candidate, dateKey: targetDate } : candidate));
      router.refresh();
    });
  }

  return (
    <>
      {canReschedule && <p className="operation-hint">Arrastrá un evento a otro día o usá su selector de fecha.</p>}
      {error && <div aria-live="polite" className="notice import-error">{error}</div>}
      <div className="calendar-scroll">
        <div aria-busy={pending} className="calendar-grid">
          {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
          {cells.map((cell) => {
            const dayEvents = cell.day ? events.filter((event) => event.dateKey === cell.key) : [];
            return (
              <div className={`calendar-day${cell.day ? "" : " outside"}`} key={cell.key} onDragOver={(event) => cell.day && canReschedule && event.preventDefault()} onDrop={(event) => { if (!cell.day) return; event.preventDefault(); move(event.dataTransfer.getData("text/plain"), cell.key); }}>
                {cell.day && <div className="calendar-day-number">{cell.day}</div>}
                {dayEvents.map((event) => (
                  <div className="calendar-event-wrap" draggable={canReschedule && !pending} key={event.id} onDragStart={(dragEvent) => dragEvent.dataTransfer.setData("text/plain", event.id)}>
                    {event.href ? <Link className="calendar-event" href={event.href}>{event.title}</Link> : <div className="calendar-event">{event.title}</div>}
                    {canReschedule && (
                      <select aria-label={`Reprogramar ${event.title}`} className="calendar-reschedule" disabled={pending} onChange={(changeEvent) => move(event.id, changeEvent.target.value)} value={event.dateKey}>
                        {days.map((day) => <option key={day.key} value={day.key}>Día {day.day}</option>)}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
