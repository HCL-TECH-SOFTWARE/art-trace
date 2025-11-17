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

// Sample: translate an .art-trace file to the .ms format (see https://bramp.github.io/js-sequence-diagrams/)

import fs from 'fs';
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import readline from 'readline';
import { parseLine, InstanceDecl, MessageOccurrance, TraceParserUtils } from 'art-trace';

const filePath = path.join(__dirname, '../traces/MoreOrLess/trace-with-timestamps.art-trace');

const input = fs.createReadStream(filePath, { encoding: 'utf8' });
const rl = readline.createInterface({ input, crlfDelay: Infinity });
try {
    let i = 0;
    let instanceMap = new Map<string, InstanceDecl>();
    
    let applicationParticipantDeclared = false;
    let systemParticipantDeclared = false;
    let timerParticipantDeclared = false;
    for await (const line of rl) {        
        let astNode = parseLine(line, i++);
        if (astNode instanceof InstanceDecl) {
            instanceMap.set(astNode.address.text, astNode);
        }   
        else
        if (astNode instanceof MessageOccurrance) {
            let senderInst = instanceMap.get(astNode.sender.text);
            let receiverInst = instanceMap.get(astNode.receiver.text);
            let senderType = senderInst ? senderInst.dynamicType.text : "";
            let receiverType = receiverInst ? receiverInst.dynamicType.text : "";

            let eventData = typeof astNode.data === 'string' ? astNode.data : JSON.stringify(astNode.data);
            console.log(`${astNode.senderName}(${senderType}) -> ${astNode.receiverName}(${receiverType}) : ${astNode.event.text}(${eventData})`);
        }
    }
}
finally {
    rl.close();
    input.close();
}
