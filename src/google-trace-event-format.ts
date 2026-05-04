/*******************************************************************************
Copyright 2025 HCL Software

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

import {
    InstanceDecl,
    MessageOccurrance,
    Note,
    TraceParser
} from './trace-parser';

/**
 * Event type emitted for duration begin/end records.
 */
export interface GoogleTraceDurationEvent {
    name: string;
    cat: string;
    ph: 'B' | 'E';
    ts: number;
    pid: string;
    tid: string;
}

/**
 * Event type emitted for instant records.
 */
export interface GoogleTraceInstantEvent {
    name: string;
    ph: 'i';
    ts: number;
    pid: string;
    s: 'g';
}

/**
 * Combined Google Trace Event type produced by this package.
 */
export type GoogleTraceEvent = GoogleTraceDurationEvent | GoogleTraceInstantEvent;

/**
 * Root object for Google Trace Event format output.
 */
export interface GoogleTraceEventFormat {
    traceEvents: GoogleTraceEvent[];
    displayTimeUnit: string;
    otherData: {
        version: string;
    };
}

class TimedTraceEvent {
    timestamp: number;
    constructor(timestamp: number) {
        this.timestamp = timestamp;
    }
}

class TimedMessageEvent extends TimedTraceEvent {
    msg: MessageOccurrance;
    receiveTime: number;
    handleTime: number;
    constructor(receiveTime: number, handleTime: number, msg: MessageOccurrance) {
        super(receiveTime);
        this.receiveTime = receiveTime;
        this.handleTime = handleTime;
        this.msg = msg;
    }
}

class TimedNoteEvent extends TimedTraceEvent {
    note: Note;
    constructor(time: number, note: Note) {
        super(time);
        this.note = note;
    }
}

/**
 * Utility for converting .art-trace content into Google Trace Event format.
 *
 * Feed lines through parseLineForGoogleTraceEventFormat(), then call
 * getGoogleTraceEventFormat() to get the final JSON-serializable object.
 */
export class GoogleTraceEventFormatConverter {
    private timedEvents: TimedTraceEvent[] = [];
    private instanceMap = new Map<string /* address */, string /* thread */>();
    private applicationName: string = 'UnknownApplication';
    private traceParser: TraceParser;

    constructor(traceParser: TraceParser = new TraceParser()) {
        this.traceParser = traceParser;
    }

    /**
     * Parse one trace line and store information needed for conversion.
     */
    public parseLineForGoogleTraceEventFormat(line: string, lineNumber: number): InstanceDecl | MessageOccurrance | Note | null {
        let astNode = this.traceParser.parseLine(line, lineNumber);
        if (astNode === null)
            return null;

        if (this.traceParser.traceConfiguration && this.traceParser.traceConfiguration?.trace?.application) {
            this.applicationName = this.traceParser.traceConfiguration.trace.application;
        }

        if (astNode instanceof MessageOccurrance) {
            if (astNode.data.time2_receive !== undefined && astNode.data.time3_handle !== undefined) {
                this.timedEvents.push(new TimedMessageEvent(astNode.data.time2_receive, astNode.data.time3_handle, astNode));
            }
        }
        else if (astNode instanceof Note) {
            if (astNode.data.time !== undefined) {
                this.timedEvents.push(new TimedNoteEvent(astNode.data.time, astNode));
            }
        }
        else if (astNode instanceof InstanceDecl) {
            let threadName = (astNode.data && astNode.data.thread_name !== undefined) ? astNode.data.thread_name : 'UnknownThread';
            this.instanceMap.set(astNode.address.text, threadName);
        }

        return astNode;
    }

    /**
     * Convert all parsed lines into Google Trace Event format.
     */
    public getGoogleTraceEventFormat(): GoogleTraceEventFormat {
        let result: GoogleTraceEvent[] = [];
        if (this.timedEvents.length === 0) {
            return {
                traceEvents: result,
                displayTimeUnit: 'ns',
                otherData: {
                    version: '1.0'
                }
            };
        }

        let sorted = this.timedEvents.sort((a, b) => a.timestamp - b.timestamp);

        // Keep stack of unfinished events for each thread.
        let callstacks = new Map<string /* thread name */, TimedMessageEvent[] /* unfinished events */>();

        for (let event of sorted) {
            if (event instanceof TimedNoteEvent) {
                let instantEvent: GoogleTraceInstantEvent = {
                    name: event.note.text,
                    ph: 'i',
                    ts: nsToMicroseconds(event.timestamp),
                    pid: this.applicationName,
                    s: 'g'
                };
                result.push(instantEvent);
                continue;
            }

            let msgEvent = event as TimedMessageEvent;
            let receiverThread = this.instanceMap.get(msgEvent.msg.receiver.text);
            if (!receiverThread)
                continue;

            let unfinishedEvents = callstacks.get(receiverThread);
            if (!unfinishedEvents) {
                unfinishedEvents = [];
                callstacks.set(receiverThread, unfinishedEvents);
            }

            while (true) {
                if (unfinishedEvents.length === 0)
                    break;

                let lastEvent = unfinishedEvents[unfinishedEvents.length - 1];
                if (lastEvent.handleTime <= msgEvent.receiveTime) {
                    let finishedEvent = unfinishedEvents.pop()!;
                    let endEvent: GoogleTraceDurationEvent = {
                        name: finishedEvent.msg.event.text,
                        cat: 'art-trace',
                        ph: 'E',
                        ts: nsToMicroseconds(finishedEvent.handleTime),
                        pid: this.applicationName,
                        tid: receiverThread
                    };
                    result.push(endEvent);
                }
                else {
                    break;
                }
            }

            let beginEvent: GoogleTraceDurationEvent = {
                name: msgEvent.msg.event.text,
                cat: 'art-trace',
                ph: 'B',
                ts: nsToMicroseconds(msgEvent.timestamp),
                pid: this.applicationName,
                tid: receiverThread
            };
            result.push(beginEvent);

            unfinishedEvents.push(msgEvent);
            unfinishedEvents.sort((a, b) => a.handleTime - b.handleTime);
        }

        callstacks.forEach((unfinishedEvents: TimedMessageEvent[], threadName: string) => {
            while (unfinishedEvents.length > 0) {
                let finishedEvent = unfinishedEvents.pop()!;
                let endEvent: GoogleTraceDurationEvent = {
                    name: finishedEvent.msg.event.text,
                    cat: 'art-trace',
                    ph: 'E',
                    ts: nsToMicroseconds(finishedEvent.handleTime),
                    pid: this.applicationName,
                    tid: threadName
                };
                result.push(endEvent);
            }
        });

        return {
            traceEvents: result,
            displayTimeUnit: 'ns',
            otherData: {
                version: '1.0'
            }
        };
    }
}

/**
 * Convert ns to microseconds as expected by Google Trace Event timestamps.
 */
export function nsToMicroseconds(ns: number): number {
    return ns / 1e3;
}
