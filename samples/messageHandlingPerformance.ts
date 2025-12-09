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

// Sample: Find the messages of a trace that took the longest time to handle

import fs from 'fs';
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import readline from 'readline';
import { TraceParser, MessageOccurrance } from 'art-trace';

class HandleTime {
    diff: number;
    msg: string;
    line: number;
    constructor(diff: number, msg: string, line: number) {
        this.diff = diff;
        this.msg = msg;
        this.line = line;
    }   
};

const filePath = path.join(__dirname, '../traces/MoreOrLess/trace-with-timestamps.art-trace');
const topCount = 5; // How many of the longest handling times to show

const input = fs.createReadStream(filePath, { encoding: 'utf8' });
const rl = readline.createInterface({ input, crlfDelay: Infinity });
try {
    let i = 0;  
    let handleTimes: HandleTime[] = [];  
    
    let traceParser = new TraceParser();

    for await (const line of rl) {        
        let astNode = traceParser.parseLine(line, i++);
        if (astNode instanceof MessageOccurrance) {
            if (astNode.data.time2_receive !== undefined && astNode.data.time3_handle !== undefined) {
                let diff = astNode.data.time3_handle - astNode.data.time2_receive;
                console.log(`Message ${astNode.event.text} handling time: ${diff} ns`);

                handleTimes.push( new HandleTime(diff, astNode.event.text, i) );                
            }
            
        }
    }
    if (handleTimes.length > 0) {
        let sorted = handleTimes.sort( (a, b) => b.diff - a.diff );
        console.log(`Top ${topCount} message handling times:`);
        for (let j = 0; j < Math.min(topCount, sorted.length); j++) {
            let ht = sorted[j];
            console.log(`--> ${ht.msg} on line ${ht.line} : ${ht.diff} ns`);
        }        
    } else {
        console.log("--> No message with timestamps found in trace");
    }
}
finally {
    rl.close();
    input.close();
}
