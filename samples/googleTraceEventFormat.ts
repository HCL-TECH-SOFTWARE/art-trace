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

// Sample: Translate an .art-trace file into the Google Trace Event Format (https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU)

import fs from 'fs';
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import readline from 'readline';
import { TraceParser, MessageOccurrance, InstanceDecl, Note } from 'art-trace';

class TimedEvent {
    timestamp: number;
    constructor(timestamp: number) {
        this.timestamp = timestamp;
    }
};

class Message extends TimedEvent {
    msg: MessageOccurrance;    
    constructor(receiveTime: number, msg: MessageOccurrance) {
        super(receiveTime);
        this.msg = msg;
    }
};

class NoteEvent extends TimedEvent {
    note: Note;
    constructor(receiveTime: number, note: Note) {
        super(receiveTime);
        this.note = note;
    } 
};

class GTEF_DurationEvent {
    name: string;
    cat: string;
    ph: string;
    ts: number;
    pid: string;
    tid: string;

    constructor(name: string, cat: string, ph: string, ts: number, pid: string, tid: string) {
        this.name = name;
        this.cat = cat;
        this.ph = ph;
        this.ts = ts;
        this.pid = pid;
        this.tid = tid;
    }
}

class GTEF_InstantEvent {
    name: string;
    ph: string;
    ts: number;
    pid: string;
    s: string;

    constructor(name: string, ts: number, pid: string) {
        this.name = name;
        this.ph = 'i';
        this.ts = ts;
        this.pid = pid;
        this.s = 'g'; // Only support global scope for now
    }
}

// Take trace file path from command line arguments
let inFilePath: string;
let outFilePath: string;
process.argv.forEach(function (val, index, array) {
    if (val.startsWith("--file=")) {
        inFilePath = val.substring("--file=".length);
    }
    else if (val.startsWith("--out=")) {
        outFilePath = val.substring("--out=".length);
    }
});

// Convert from ns to µs
function nsToMicroseconds(ns: number): number {    
    return ns / 1e3;
}

const filePath = inFilePath ? inFilePath : path.join(__dirname, '../traces/NestedFixedParts/.trace.art-trace');

// Read trace and sort messages by receive time to create Google Trace Event Format output
async function sortAndTranslate(filePath : string) : Promise<GTEF_DurationEvent[]> {
    let input = fs.createReadStream(filePath, { encoding: 'utf8' });
    let rl = readline.createInterface({ input, crlfDelay: Infinity });

    let result: any[] = [];
    try {
        let i = 0;  
        let events: TimedEvent[] = [];  
        let traceParser = new TraceParser();
        const instanceMap = new Map<string /* address */, string /* thread */>();
        let applicationName = "UnknownApplication";
        
        for await (const line of rl) {     
            let astNode = traceParser.parseLine(line, i++);
            if (astNode === null)
                continue

            if (traceParser.traceConfiguration && traceParser.traceConfiguration?.trace?.application) {
                applicationName = traceParser.traceConfiguration.trace.application;        
            }

            if (astNode instanceof MessageOccurrance) {
                if (astNode.data.time2_receive !== undefined && astNode.data.time3_handle !== undefined) {
                    events.push( new Message(astNode.data.time2_receive, astNode) );
                }                
            }
            else if (astNode instanceof Note) {
                if (astNode.data.time !== undefined) {
                    events.push( new NoteEvent(astNode.data.time, astNode) );
                }
            }
            else if (astNode instanceof InstanceDecl) {
                let threadName = (astNode.data.thread_name !== undefined) ? astNode.data.thread_name : 'UnknownThread';
                instanceMap.set(astNode.address.text, threadName);
            }
        }
        if (events.length == 0) {
            console.log("--> No trace events (messages or notes) with timestamps found in trace");
            return result;
        }
        
        let sorted = events.sort( (a, b) => a.timestamp - b.timestamp );
        
        // Keep stack of unfinished events for each thread
        let callstacks = new Map<string /* thread name */, Message[] /* unfinished events */ >();        

        // Now create Google Trace Event Format output from the sorted messages
        for (let event of sorted) {
            if (event instanceof NoteEvent) {
                // Translate to instant event
                let gtefEvent = new GTEF_InstantEvent(
                    event.note.text,                    
                    nsToMicroseconds(event.timestamp),
                    applicationName, // pid
                );
                result.push(gtefEvent);
                continue;
            }

            let msg = event as Message;
            // Finish all unfinished events before the current message's receive time
            let receiverThread = instanceMap.get(msg.msg.receiver.text);
            if (!receiverThread) {
                console.warn(`--> Warning: No thread found for receiver instance ${msg.msg.receiver.text}`);
                continue;
            }
            let unfinishedEvents = callstacks.get(receiverThread);
            if (!unfinishedEvents) {
                unfinishedEvents = [];
                callstacks.set(receiverThread, unfinishedEvents);
            }
            
            while (true) {
                if (unfinishedEvents.length == 0) 
                    break;
                    
                let lastEvent = unfinishedEvents[unfinishedEvents.length - 1];
                if (lastEvent.msg.data.time3_handle <= msg.msg.data.time2_receive) {
                    let finishedEvent = unfinishedEvents.pop()!;
                    let endEvent = new GTEF_DurationEvent(
                        finishedEvent.msg.event.text,
                        "art-trace",
                        "E",
                        nsToMicroseconds(finishedEvent.msg.data.time3_handle),
                        applicationName, // pid
                        receiverThread  // tid
                    );
                    result.push(endEvent);
                }
                else {
                    break; 
                }
            }                    

            let beginEvent = new GTEF_DurationEvent(
                msg.msg.event.text,
                "art-trace",
                "B",
                nsToMicroseconds(msg.timestamp), 
                applicationName, // pid
                receiverThread  // tid
            );
            result.push(beginEvent);            

            unfinishedEvents.push(msg);
            // Keep unfinished events sorted according to their handle time
            unfinishedEvents.sort( (a, b) => a.msg.data.time3_handle - b.msg.data.time3_handle );
        }
        
        // Finish all remaining unfinished events
        callstacks.forEach((unfinishedEvents: Message[], threadName: string) => {
            while (unfinishedEvents.length > 0) {
                let finishedEvent = unfinishedEvents.pop();                
                let endEvent = new GTEF_DurationEvent(
                    finishedEvent.msg.event.text,
                    "art-trace",
                    "E",
                    nsToMicroseconds(finishedEvent.msg.data.time3_handle), 
                    applicationName, // pid
                    threadName  // tid
                );
                result.push(endEvent);
            }
        });

        return result;
    }
    catch (err) {
        console.error("Error processing trace file: ", err);
        return result;
    }
    finally {
        rl.close();
        input.close();
    }
}

let sorted = await sortAndTranslate(filePath);

let gtefObject = {
    traceEvents: sorted,
    displayTimeUnit: "ns",    
    otherData: {
        version: "1.0"
    }
};

let json = JSON.stringify(gtefObject);

if (outFilePath) {
    fs.writeFileSync(outFilePath, json, { encoding: 'utf8' });
    console.log(`Sorted trace written to ${outFilePath}`);
}
else {
    console.log(json);
}

