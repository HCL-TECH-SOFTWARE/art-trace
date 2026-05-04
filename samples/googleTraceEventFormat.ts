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
import { GoogleTraceEventFormatConverter } from 'art-trace';

// Take trace file path from command line arguments
let inFilePath: string | undefined = undefined;
let outFilePath: string | undefined = undefined;
process.argv.forEach(function (val: string) {
    if (val.startsWith("--file=")) {
        inFilePath = val.substring("--file=".length);
    }
    else if (val.startsWith("--out=")) {
        outFilePath = val.substring("--out=".length);
    }
});

const filePath = inFilePath ? inFilePath : path.join(__dirname, '../traces/NestedFixedParts/.trace.art-trace');

// Read trace and sort messages by receive time to create Google Trace Event Format output
async function sortAndTranslate(filePath : string) {
    let input = fs.createReadStream(filePath, { encoding: 'utf8' });
    let rl = readline.createInterface({ input, crlfDelay: Infinity });

    try {
        let i = 0;
        let converter = new GoogleTraceEventFormatConverter();

        for await (const line of rl) {     
            converter.parseLineForGoogleTraceEventFormat(line, i++);
        }

        return converter.getGoogleTraceEventFormat();
    }
    catch (err) {
        console.error("Error processing trace file: ", err);
        return {
            traceEvents: [],
            displayTimeUnit: "ns",
            otherData: {
                version: "1.0"
            }
        };
    }
    finally {
        rl.close();
        input.close();
    }
}

let gtefObject = await sortAndTranslate(filePath);
let json = JSON.stringify(gtefObject);

if (outFilePath) {
    fs.writeFileSync(outFilePath, json, { encoding: 'utf8' });
    console.log(`Sorted trace written to ${outFilePath}`);
}
else {
    console.log(json);
}

