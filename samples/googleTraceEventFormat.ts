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
import { parseLine, InstanceDecl, MessageOccurrance, TraceParserUtils } from 'art-trace';
import { start } from 'repl';

class Message {
    receiveTime: number;
    msg: MessageOccurrance;    
    constructor(receiveTime: number, msg: MessageOccurrance) {
        this.receiveTime = receiveTime;
        this.msg = msg;        
    }
};

class GTEF_DurationEvent {
    name: string;
    cat: string;
    ph: string;
    ts: number;
    pid: number;
    tid: number;

    constructor(name: string, cat: string, ph: string, ts: number, pid: number, tid: number) {
        this.name = name;
        this.cat = cat;
        this.ph = ph;
        this.ts = ts;
        this.pid = pid;
        this.tid = tid;
    }
}

const filePath = path.join(__dirname, '../traces/NestedFixedParts/.trace.art-trace');

// Read trace and sort messages by receive time to create Google Trace Event Format output
async function sortAndTranslate(filePath : string) : Promise<GTEF_DurationEvent[]> {
    let input = fs.createReadStream(filePath, { encoding: 'utf8' });
    let rl = readline.createInterface({ input, crlfDelay: Infinity });

    let result: GTEF_DurationEvent[] = [];
    try {
        let i = 0;  
        let messages: Message[] = [];  
        
        for await (const line of rl) {        
            let astNode = parseLine(line, i++);
            if (astNode instanceof MessageOccurrance) {
                if (astNode.data.time2_receive !== undefined && astNode.data.time3_handle !== undefined) {
                    messages.push( new Message(astNode.data.time2_receive, astNode) );
                }
                
            }
        }
        if (messages.length == 0) {
            console.log("--> No message with timestamps found in trace");
            return result;
        }
        
        let sorted = messages.sort( (a, b) => a.receiveTime - b.receiveTime );
        
        // Keep stack of unfinished events (TODO: make it per thread)
        let unfinishedEvents: Message[] = [];

        // Now create Google Trace Event Format output from the sorted messages
        for (let msg of sorted) {
            // Finish all unfinished events before the current message's receive time
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
                        Math.round(finishedEvent.msg.data.time3_handle / 1000), // Convert from ns to µs
                        1, // pid
                        1  // tid
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
                Math.round(msg.receiveTime / 1000), // Convert from ns to µs
                1, // pid
                1  // tid
            );
            result.push(beginEvent);            

            unfinishedEvents.push(msg);
            // Keep unfinished events sorted according to their handle time
            unfinishedEvents.sort( (a, b) => b.msg.data.time3_handle - a.msg.data.time3_handle );
        }
        
        // Finish all remaining unfinished events
        while (unfinishedEvents.length > 0) {
            let lastEvent = unfinishedEvents[unfinishedEvents.length - 1];
            
            let finishedEvent = unfinishedEvents.pop()!;
            let endEvent = new GTEF_DurationEvent(
                finishedEvent.msg.event.text,
                "art-trace",
                "E",
                Math.round(finishedEvent.msg.data.time3_handle / 1000), // Convert from ns to µs
                1, // pid
                1  // tid
            );
            result.push(endEvent);
        }

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

console.log(json);

