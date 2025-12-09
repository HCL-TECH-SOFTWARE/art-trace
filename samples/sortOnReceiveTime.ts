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
import { TraceSorter, SortCriteria } from 'art-trace';

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

const filePath = inFilePath ? inFilePath : path.join(__dirname, '../traces/NestedFixedParts/.trace.art-trace');

// Read trace and return messages sorted by receive time
async function sortOnReceiveTime(filePath : string) : Promise<string[]> {
    let input = fs.createReadStream(filePath, { encoding: 'utf8' });
    let rl = readline.createInterface({ input, crlfDelay: Infinity });

    try {              
        let traceSorter = new TraceSorter(SortCriteria.RECEIVE_TIME);

        let i = 0;
        for await (const line of rl) {        
            traceSorter.parseLineForSorting(line, i++);            
        }
        let sorted = traceSorter.getSortedMessages();
                
        return sorted.map(obj => obj.line);
    }
    catch (err) {
        console.error("Error processing trace file: ", err);
        return [];
    }
    finally {
        rl.close();
        input.close();
    }
}

let sorted = await sortOnReceiveTime(filePath);

if (outFilePath) {
    fs.writeFileSync(outFilePath, sorted.join("\n"), { encoding: 'utf8' });
    console.log(`Sorted trace written to ${outFilePath}`);
}
else {
    console.log("Messages sorted by receive time:");
    for (let line of sorted) {
        console.log(line);
    }
}
