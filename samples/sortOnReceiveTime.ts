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

// Sample: Order messages of a trace by their receive time (instead of handle time which is the default)

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
    msg: string;    
    constructor(handleTime: number, msg: string) {
        this.receiveTime = handleTime;
        this.msg = msg;        
    }
};

const filePath = path.join(__dirname, '../traces/NestedFixedParts/.trace.art-trace');

// Read trace and return messages sorted by receive time
async function sortOnReceiveTime(filePath : string) : Promise<string[]> {
    let input = fs.createReadStream(filePath, { encoding: 'utf8' });
    let rl = readline.createInterface({ input, crlfDelay: Infinity });

    let result: string[] = [];
    try {
        let i = 0;  
        let messages: Message[] = [];  
        
        for await (const line of rl) {        
            let astNode = parseLine(line, i++);
            if (astNode instanceof MessageOccurrance) {
                if (astNode.data.time2_receive !== undefined) {
                    messages.push( new Message(astNode.data.time2_receive, line) );
                }
                
            }
        }
        if (messages.length == 0) {
            console.log("--> No message with timestamps found in trace");
            return result;
        }
        
        let sorted = messages.sort( (a, b) => a.receiveTime - b.receiveTime );
        
        // Iterate input lines again and replace message lines with sorted ones        
        let startIndex = 0;
        input = fs.createReadStream(filePath, { encoding: 'utf8' });
        rl = readline.createInterface({ input, crlfDelay: Infinity });
        for await (const line of rl) {        
            let astNode = parseLine(line, i++);
            if (astNode instanceof MessageOccurrance) {
                
                let index = startIndex;
                for (; index < sorted.length; index++) {
                    let msg = sorted[index];
                    if (msg.msg === line) {
                        let messages : string[] = sorted.slice(startIndex, index + 1).map(m => m.msg); 
                        result.push(...messages);
                        startIndex = index + 1;
                        break;
                    }                    
                }
            }
            else {
                result.push(line);
            }
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

let sorted = await sortOnReceiveTime(filePath);

console.log("Messages sorted by receive time:");
for (let line of sorted) {
    console.log(line);
}
