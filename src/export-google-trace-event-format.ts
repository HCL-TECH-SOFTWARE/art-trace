/*******************************************************************************
Copyright 2026 HCL Software

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*******************************************************************************/

import { InstanceDecl, MessageOccurrance, Note, TraceParser, TraceParserUtils, type Token } from "./trace-parser.js";

export interface GTEFDurationEvent {
    name: string;
    cat: string;
    ph: 'B' | 'E';
    ts: number;
    pid: string;
    tid: string;
}

export interface GTEFInstantEvent {
    name: string;
    ph: 'i';
    ts: number;
    pid: string;
    s: 'g';
}

export interface GTEFOutput {
    traceEvents: Array<GTEFDurationEvent | GTEFInstantEvent>;
    displayTimeUnit: 'ns';
    otherData: {
        version: '1.0';
    };
}

export interface GTEFTranslationWarning {
    message: string;
    receiverAddress?: string;
}

export interface GTEFTranslationResult {
    output: GTEFOutput;
    warnings: GTEFTranslationWarning[];
}

interface TimedMessageEvent {
    timestamp: number;
    message: MessageOccurrance;
}

interface TimedNoteEvent {
    timestamp: number;
    note: Note;
}

type TimedEvent = TimedMessageEvent | TimedNoteEvent;

interface UntimedMessageEvent {
    message: MessageOccurrance;
    missingTime2Receive: boolean;
    missingTime3Handle: boolean;
}

interface UntimedNoteEvent {
    note: Note;
}

type UntimedEvent = UntimedMessageEvent | UntimedNoteEvent;

function nsToMicroseconds(timestamp: number): number {
    return timestamp / 1e3;
}

function tokenText(token: Token): string {
    if (token.value !== undefined && typeof token.value === 'string') {
        return token.value;
    }
    return token.text;
}

function inferApplicationNameFromInstance(astNode: InstanceDecl): string | undefined {
    if (!TraceParserUtils.isTopCapsuleInstance(astNode) || !astNode.dynamicType?.text) {
        return undefined;
    }

    const topCapsuleName = astNode.dynamicType.text;
    if (topCapsuleName.toUpperCase().endsWith('.EXE')) {
        return topCapsuleName;
    }

    return `${topCapsuleName}.EXE`;
}

function parseTimedEvents(
    parser: TraceParser,
    traceText: string,
    instanceToThread: Map<string, string>
): { timedEvents: TimedEvent[]; untimedEvents: UntimedEvent[]; applicationName: string } {
    const timedMessages: MessageOccurrance[] = [];
    const timedNotes: Note[] = [];
    const untimedEvents: UntimedEvent[] = [];
    let applicationName = 'UnknownApplication';

    const lines = traceText.split(/\r?\n/);
    for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
        const astNode = parser.parseLine(lines[lineNumber], lineNumber + 1);
        if (astNode === null) {
            continue;
        }

        if (parser.traceConfiguration?.trace?.application) {
            applicationName = parser.traceConfiguration.trace.application;
        }

        if (astNode instanceof MessageOccurrance) {
            const messageData = astNode.data;
            if (messageData && typeof messageData.time2_receive === 'number' && typeof messageData.time3_handle === 'number') {
                timedMessages.push(astNode);
            } else {
                untimedEvents.push({
                    message: astNode,
                    missingTime2Receive: !messageData || typeof messageData.time2_receive !== 'number',
                    missingTime3Handle: !messageData || typeof messageData.time3_handle !== 'number'
                });
            }
            continue;
        }

        if (astNode instanceof Note) {
            const noteData = astNode.data;
            if (noteData && typeof noteData.time === 'number') {
                timedNotes.push(astNode);
            } else {
                untimedEvents.push({ note: astNode });
            }
            continue;
        }

        if (astNode instanceof InstanceDecl) {
            const inferredApplicationName = inferApplicationNameFromInstance(astNode);
            if (inferredApplicationName && !parser.traceConfiguration?.trace?.application) {
                applicationName = inferredApplicationName;
            }

            const address = tokenText(astNode.address);
            if (!address) {
                continue;
            }
            const threadName = astNode.data?.thread_name || 'UnknownThread';
            instanceToThread.set(address, threadName);
        }
    }

    const events: TimedEvent[] = [
        ...timedMessages.map(message => ({
            timestamp: message.data.time2_receive as number,
            message
        })),
        ...timedNotes.map(note => ({
            timestamp: note.data.time as number,
            note
        }))
    ];

    events.sort((a, b) => a.timestamp - b.timestamp);
    return { timedEvents: events, untimedEvents, applicationName };
}

/**
 * Translate .art-trace text to Google Trace Event Format.
 *
 * Output format reference:
 * https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU
 */
export function toGoogleTraceEventFormat(traceText: string): GTEFTranslationResult {
    const parser = new TraceParser();
    const instanceToThread = new Map<string, string>();
    const warnings: GTEFTranslationWarning[] = [];
    const traceEvents: Array<GTEFDurationEvent | GTEFInstantEvent> = [];
    const callstacks = new Map<string, MessageOccurrance[]>();

    const parsedTrace = parseTimedEvents(parser, traceText, instanceToThread);

    for (const event of parsedTrace.timedEvents) {
        if ('note' in event) {
            traceEvents.push({
                name: event.note.text,
                ph: 'i',
                ts: nsToMicroseconds(event.timestamp),
                pid: parsedTrace.applicationName,
                s: 'g'
            });
            continue;
        }

        const msg = event.message;
        const receiverAddress = tokenText(msg.receiver);
        const receiverThread = instanceToThread.get(receiverAddress);
        if (!receiverThread) {
            warnings.push({
                message: `No thread found for receiver instance ${receiverAddress}`,
                receiverAddress
            });
            continue;
        }

        let unfinishedEvents = callstacks.get(receiverThread);
        if (!unfinishedEvents) {
            unfinishedEvents = [];
            callstacks.set(receiverThread, unfinishedEvents);
        }

        while (unfinishedEvents.length > 0) {
            const latestUnfinished = unfinishedEvents[unfinishedEvents.length - 1];
            if ((latestUnfinished.data.time3_handle as number) <= (msg.data.time2_receive as number)) {
                const finishedEvent = unfinishedEvents.pop();
                if (!finishedEvent) {
                    break;
                }
                traceEvents.push({
                    name: tokenText(finishedEvent.event),
                    cat: 'art-trace',
                    ph: 'E',
                    ts: nsToMicroseconds(finishedEvent.data.time3_handle as number),
                    pid: parsedTrace.applicationName,
                    tid: receiverThread
                });
            }
            else {
                break;
            }
        }

        traceEvents.push({
            name: tokenText(msg.event),
            cat: 'art-trace',
            ph: 'B',
            ts: nsToMicroseconds(event.timestamp),
            pid: parsedTrace.applicationName,
            tid: receiverThread
        });

        unfinishedEvents.push(msg);
        unfinishedEvents.sort((a, b) => (a.data.time3_handle as number) - (b.data.time3_handle as number));
    }

    callstacks.forEach((unfinishedEvents, threadName) => {
        while (unfinishedEvents.length > 0) {
            const finishedEvent = unfinishedEvents.pop();
            if (!finishedEvent) {
                continue;
            }
            traceEvents.push({
                name: tokenText(finishedEvent.event),
                cat: 'art-trace',
                ph: 'E',
                ts: nsToMicroseconds(finishedEvent.data.time3_handle as number),
                pid: parsedTrace.applicationName,
                tid: threadName
            });
        }
    });

    if (parsedTrace.untimedEvents.length > 0) {
        const maxTimedTimestamp = traceEvents
            .reduce((max, event) => Math.max(max, event.ts), -1);
        let syntheticTimestamp = maxTimedTimestamp + 1;

        let untimedMessages = 0;
        let untimedNotes = 0;
        for (const untimedEvent of parsedTrace.untimedEvents) {
            if ('note' in untimedEvent) {
                untimedNotes++;
                continue;
            }

            untimedMessages++;
        }

        const warningParts: string[] = [];
        if (untimedMessages > 0) {
            warningParts.push(
                `${untimedMessages} message event(s) could not be exported as duration events ` +
                `because required timestamps were missing (time2_receive and/or time3_handle).`
            );
        }
        if (untimedNotes > 0) {
            warningParts.push(`${untimedNotes} note event(s) were missing the required time timestamp.`);
        }
        warningParts.push('These events were exported as instant events to preserve trace order.');

        warnings.push({ message: warningParts.join(' ') });

        for (const untimedEvent of parsedTrace.untimedEvents) {
            if ('note' in untimedEvent) {
                traceEvents.push({
                    name: untimedEvent.note.text || 'note',
                    ph: 'i',
                    ts: syntheticTimestamp++,
                    pid: parsedTrace.applicationName,
                    s: 'g'
                });
                continue;
            }

            const eventName = tokenText(untimedEvent.message.event) || `${untimedEvent.message.senderName} -> ${untimedEvent.message.receiverName}`;
            traceEvents.push({
                name: eventName,
                ph: 'i',
                ts: syntheticTimestamp++,
                pid: parsedTrace.applicationName,
                s: 'g'
            });
        }
    }

    return {
        output: {
            traceEvents,
            displayTimeUnit: 'ns',
            otherData: {
                version: '1.0'
            }
        },
        warnings
    };
}