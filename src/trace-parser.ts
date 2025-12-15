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

import {Tokenizr} from "tokenizr"
export type Token = InstanceType<typeof Tokenizr.Token>;

/**
 * Utility for parsing an .art-trace file
 * @author Mattias Mohlin
 */
export class TraceParser {
    private lexer : Tokenizr;
    private traceConfigUnderConstruction : string | undefined = undefined;

    // The trace configuration found in the trace (if any), parsed into an object from JSON
    traceConfiguration : any | undefined = undefined;    

    /**
     * Construct the TraceParser.
     * @throws an error if an internal error occurs (e.g. if the scanner could not be initialized)
     */
    constructor() {
        this.lexer = new Tokenizr();        

        // Keyword
        this.lexer.rule(/instance|note/, (ctx, match) => {
            ctx.accept("keyword");
        });
        // Name
        this.lexer.rule(/[a-zA-Z_][a-zA-Z0-9_]*/, (ctx, match) => {
            ctx.accept("name");
        });        
        // String
        this.lexer.rule(/"(?:[^"\\\r\n]|\\.)*"/, (ctx, match) => {
            let str = match[0].substring(1, match[0].length - 1); // Remove quotes
            ctx.accept("string", str);
        });                
        // Line comment (//)
        // Note that we don't support block comments (/* */) since we are parsing line-by-line
        this.lexer.rule(/\/\/.*?$/, (ctx, match) => {            
            if (!this.traceConfigUnderConstruction && match[0] == '// {') {
                this.traceConfigUnderConstruction = '{'; // Begin trace configuration
            }
            else if (this.traceConfigUnderConstruction && match[0] == '// }') {
                this.traceConfigUnderConstruction += '}'; // End trace configuration
                try {
                    this.traceConfiguration = JSON.parse(this.traceConfigUnderConstruction);
                }
                catch (e) {
                    // Invalid trace configuration JSON
                    console.error("Warning: Invalid trace configuration JSON found in trace.");
                }
                this.traceConfigUnderConstruction = undefined
            }
            else if (this.traceConfigUnderConstruction) {
                this.traceConfigUnderConstruction += match[0].substring(2).trim();
            }
            ctx.ignore();
        });
        // Whitespace
        this.lexer.rule(/[ \t\r\n]+/, (ctx, match) => {
            ctx.ignore();
        });
        // Address
        this.lexer.rule(/0x[0-9a-fA-F]+/, (ctx, match) => {
            ctx.accept("address");
        });
        // Number
        this.lexer.rule(/[0-9]+/, (ctx, match) => {
            ctx.accept("number", parseInt(match[0]))
        })        
        // Arrow (->)
        this.lexer.rule(/\-\>/, (ctx, match) => {
            ctx.accept("arrow");
        });
        // Dot (.)
        this.lexer.rule(/\./, (ctx, match) => {
            ctx.accept("dot");
        });
        // Open square bracket ([)
        this.lexer.rule(/\[/, (ctx, match) => {
            ctx.accept("open-square-bracket");
        });
        // Close square bracket (])
        this.lexer.rule(/\]/, (ctx, match) => {
            ctx.accept("close-square-bracket");
        });
        // Instance or note data (JSON object)
        this.lexer.rule(/\{.*$/, (ctx, match) => {
            let str = match[0];
            let data : any;
            try {
                let j = JSON.parse(str);                
                if (j.thread_name !== undefined) {
                    data = new InstanceData();
                    data.thread_name = j.thread_name;
                }
                else if (j.time !== undefined) {
                    data = new NoteData();
                    data.time = j.time;
                }
            }
            catch (e) {
                // No valid JSON data found 
            }        

            ctx.accept("optional-data", data);
        });   
        // Message data (any text enclosed in parentheses, optionally followed by JSON)
        this.lexer.rule(/\(.*$/, (ctx, match) => {
            let str = match[0];            
            let i = str.lastIndexOf(')');
            let md = new MessageData();
            if (i != -1) {
                md.paramData = str.substring(1, i);
                try {
                    let j = JSON.parse(str.substring(i + 1));
                    if (j.time2_receive !== undefined)
                        md.time2_receive = j.time2_receive;
                    if (j.time3_handle !== undefined)
                        md.time3_handle = j.time3_handle;
                    if (j.invoke !== undefined)
                        md.invoke = j.invoke;
                    if (j.reply !== undefined)
                        md.reply = j.reply;
                }
                catch (e) {
                    // No JSON data found after closing parenthesis
                }
            }
            else
                md.paramData = str.substring(1); // Missing closing parenthesis

            ctx.accept("event-with-data", md);
        });        
        // Colon (:)
        this.lexer.rule(/\:/, (ctx, match) => {
            ctx.accept("colon");
        });        
    }

    /**
     * Parse a line from a trace file
     * @param line a line from a trace file to scan
     * @param line number in the document
     * @returns an AST node or null in case of syntax error
     * @throws an error if an internal error occurs (e.g. if the scanner could not be initialized)
     */
    public parseLine(line : string, lineNumber : number) : InstanceDecl | MessageOccurrance | Note | null {

        this.lexer.input(line);        

        try {                
            let tokens = this.lexer.tokens();
            if (tokens.length == 1 && tokens[0].isA("EOF"))
                return null; // Empty line (or only containing whitespace)

            for (let token of tokens) {
                token.line = lineNumber;
            }

            // Scanning successful, now parse the tokens
            let instanceDecl = isInstanceDecl(tokens);
            if (instanceDecl)
                return instanceDecl;

            let messageOccurrance = isMessageOccurrance(tokens);
            if (messageOccurrance)
                return messageOccurrance;

            let note = isNote(tokens);
            if (note)
                return note;

            return null;
        }
        catch (e) {
            // Syntax error
            return null;
        }
    }

}

/**
 * AST node for an instance declaration
 */
export class InstanceDecl {
    address : Token;    
    structureExpr : Token[] = []; // Simplified list of tokens with semantic significance
    dynamicType : Token; // Dynamic instance type (omitted for built-in TargetRTS instances)
    data : InstanceData; // Data associated with the instance
}

/**
 * Data associated with a message
 */
export class MessageData {
    paramData : string = ''; // Parameter data for the message
    time2_receive : number | undefined = undefined;
    time3_handle : number | undefined = undefined;
    invoke : string | undefined = undefined; // Message address for a synchronous invoke
    reply : string | undefined = undefined; // Message address for a synchronous reply
}

/**
 * Data associated with an instance
 */
export class InstanceData {
    thread_name : string = '';
}


/**
 * AST node for a message occurrance
 */
export class MessageOccurrance {
    sender : Token; // Address of sender
    receiver : Token; // Address of receiver
    senderName: string;
    receiverName: string;
    senderPort: Token;
    receiverPort: Token;
    senderPortIndex: number;
    receiverPortIndex: number;
    event: Token;
    data: MessageData; // Data associated with the message
}

/**
 * Data associated with a note
 */
export class NoteData {
    time : number | undefined = undefined; // Timestamp associated with the note
}

/**
 * AST node for a note
 */
export class Note {    
    text: string;
    line?: number;
    data : NoteData; // Data associated with the note
}

/**
 * Utilities for working with a parsed trace
 */
export class TraceParserUtils {
    /**
     * Answers if the instance is the top capsule instance (application)
     */    
    public static isTopCapsuleInstance(astNode : InstanceDecl) : boolean {
        if (astNode.structureExpr.length == 1 && astNode.structureExpr[0].text == 'application')
            return true;

        return false;
    }

    /**
     * Answers if the instance is the system instance
     */
    public static isSystemInstance(astNode : InstanceDecl) : boolean {
        let str = TraceParserUtils.structureExprToString(astNode.structureExpr);
        return (str == "Top" && astNode.dynamicType.text == "RTSuperActor");
    }

    /**
     * Answers if the instance is the timer instance
     */
    public static isTimerInstance(astNode : InstanceDecl) : boolean {
        let str = TraceParserUtils.structureExprToString(astNode.structureExpr);
        return (str == "specials" && astNode.dynamicType.text == "RTTimerActor");
    }

    /**
     * Return a string representation of a structure expression 
     */
    public static structureExprToString(structureExpr: Token[]): string {
        let result = "";
        for (let token of structureExpr) {
            if (token.value !== undefined && typeof token.value === 'number') {
                result += '[' + token.value.toString() + ']';
            }
            else {
                if (result.length > 0)
                    result += '.';
                result += token.text;
            }
        }
        return result;
    }
}

/**
 * Attempt to match a sequence of tokens.
 * @param i index of start token (passed by reference)
 * @param tokens token sequence to match against
 * @param tokenKinds expected tokens (prefix a token with "kw:" if keyword)
 * @param onMatch callback function called if tokens were matched (if it returns true, i is advanced)
 * @returns true if tokens were successfully matched, false otherwise
 */
function matchTokens(i : {value : number}, tokens : Token[], tokenKinds : string[], onMatch : (tokens : Token[]) => boolean | void) : boolean {
    if (tokens.length < i.value + tokenKinds.length) 
        return false;

    for (let j = 0; j < tokenKinds.length; j++) {
        let isKeyword = tokenKinds[j].startsWith('kw:');
        if (!isKeyword && tokens[i.value + j].isA(tokenKinds[j])) continue;
        if (isKeyword && tokens[i.value + j].isA('keyword', tokenKinds[j].substring(3))) continue;
            
        return false; // Token did not match    
    }

    // All tokens matched
    let res = onMatch(tokens.slice(i.value, i.value + tokenKinds.length));
    if (res !== false)
        i.value += tokenKinds.length;    

    return true;
}

/**
 * If the tokens represent an instance declaration return an InstanceDecl, otherwise null
 * @param tokens 
 * @returns InstanceDecl or null
 */
function isInstanceDecl(tokens : Token[]) : InstanceDecl | null {
    let instanceDecl = new InstanceDecl();
    let index = {"value" : 0};

    // instance keyword and address (mandatory)
    if (! matchTokens(index, tokens, ['kw:instance', 'address'], (matchedToken) => {
        instanceDecl.address = matchedToken[1];
    })) 
        return null; // syntax error        
            
    // Expect here any number of dot-separated names optionally followed by an index specifier.
    // The sequence stops with a colon or EOF.            
    for (; index.value < tokens.length; ) {
        if (! matchTokens(index, tokens, ['name'], (matchedToken) => {
            instanceDecl.structureExpr.push(tokens[index.value]);
        })) 
            return null; // syntax error 

        // dot (optional)
        if (matchTokens(index, tokens, ['dot'], (matchedToken) => {}))
            continue; // Dot must be followed by a name

        // [index] (optional)
        matchTokens(index, tokens, ['open-square-bracket', 'number', 'close-square-bracket'], (matchedToken) => {
            instanceDecl.structureExpr.push(matchedToken[1]);
        });
            
        // dot (optional)
        if (matchTokens(index, tokens, ['dot'], (matchedToken) => {}))
            continue; // Dot must be followed by a name

        if (matchTokens(index, tokens, ['colon'], (matchedToken) => {
                return false; // do not consume the token
            }) ||
            matchTokens(index, tokens, ['EOF'], (matchedToken) => {}))
            break; // end of structure expression        
    }

    // : dynamic type (optional)
    matchTokens(index, tokens, ['colon', 'name'], (matchedToken) => {
        instanceDecl.dynamicType = matchedToken[1];
    });

    // instance data (optional)
    matchTokens(index, tokens, ['optional-data'], (matchedToken) => {
        instanceDecl.data = matchedToken[0].value as InstanceData;
    });

    return instanceDecl;    
}

/**
 * If the tokens represent a message occurrence return a MessageOccurrance, otherwise null
 * @param tokens 
 * @returns MessageOccurrance or null
 */
function isMessageOccurrance(tokens : Token[]) : MessageOccurrance | null {    
    let messageOccurrance = new MessageOccurrance();

    let index = {"value" : 0};
    // sender address and name (mandatory)
    if (! matchTokens(index, tokens, ['address', 'name'], (matchedToken) => {
        messageOccurrance.sender = matchedToken[0];
        messageOccurrance.senderName = matchedToken[1].text;
    })) 
        return null; // syntax error

    // sender port (optional)
    matchTokens(index, tokens, ['dot', 'name'], (matchedToken) => {
        messageOccurrance.senderPort = matchedToken[1];
    });    

    // sender port index (optional)
    matchTokens(index, tokens, ['open-square-bracket', 'number', 'close-square-bracket'], (matchedToken) => {
        messageOccurrance.senderPortIndex = matchedToken[1].value as number;
    });    

    // -> receiver address and name (mandatory)
    if (! matchTokens(index, tokens, ['arrow', 'address', 'name'], (matchedToken) => {
        messageOccurrance.receiver = matchedToken[1];
        messageOccurrance.receiverName = matchedToken[2].text;
    })) 
        return null; // syntax error

    // receiver port (optional)
    matchTokens(index, tokens, ['dot', 'name'], (matchedToken) => {
        messageOccurrance.receiverPort = matchedToken[1];
    });    

    // receiver port index (optional)
    matchTokens(index, tokens, ['open-square-bracket', 'number', 'close-square-bracket'], (matchedToken) => {
        messageOccurrance.receiverPortIndex = matchedToken[1].value as number;
    }); 

    // : event with data (mandatory)
    if (! matchTokens(index, tokens, ['colon', 'name', 'event-with-data'], (matchedToken) => {
        messageOccurrance.event = matchedToken[1];
        messageOccurrance.data = matchedToken[2].value as MessageData;
    })) 
        return null; // syntax error

    return messageOccurrance;    
}

/**
 * If the tokens represent a note return a Note, otherwise null
 * @param tokens 
 * @returns Note or null
 */
function isNote(tokens : Token[]) : Note | null {
    let note = new Note();
    let index = {"value" : 0};
    // sender address and name (mandatory)
    if (! matchTokens(index, tokens, ['kw:note', 'string'], (matchedToken) => {
        note.text = matchedToken[1].value as string;
        note.line = matchedToken[0].line;        
    })) 
        return null; // syntax error

    // note data (optional)
    matchTokens(index, tokens, ['optional-data'], (matchedToken) => {
        note.data = matchedToken[0].value as NoteData;
    });

    return note;    
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * A line from a trace file and its corresponding AST node
 */
export class LineAndNode {
    line: string;
    astNode: InstanceDecl | MessageOccurrance | Note;

    constructor(line: string, astNode: InstanceDecl | MessageOccurrance | Note) {
        this.line = line;
        this.astNode = astNode;
    }
}

class MessageSortData {
    time: number;
    msg: string;   
    msgOccurrance: MessageOccurrance; 

    constructor(time: number, msgOccurrance: MessageOccurrance, msg: string) {
        this.time = time;
        this.msgOccurrance = msgOccurrance;
        this.msg = msg;                
    }
};

export enum SortCriteria {
    RECEIVE_TIME,
    HANDLE_TIME
}

/**
 * Sort a trace's messages according to some criteria
 */
export class TraceSorter {

    private messages: MessageSortData[] = [];
    private lines : string[] = [];
    private sortCriteria : SortCriteria;
    private traceParser : TraceParser;

    constructor(sortCriteria : SortCriteria, traceParser : TraceParser = new TraceParser()) {
        this.sortCriteria = sortCriteria;
        this.traceParser = traceParser;
    }

    /**
     * Parse a line from a trace file, and store it for later sorting
     * @param line a line from a trace file
     * @param line line number for the line
     * @returns an AST node or null in case of syntax error
     * @throws an error if an internal error occurs (e.g. if the scanner could not be initialized)
     */
    public parseLineForSorting(line : string, lineNumber : number) : InstanceDecl | MessageOccurrance | Note | null {
        this.lines.push(line);
        let astNode = this.traceParser.parseLine(line, lineNumber);
        if (astNode instanceof MessageOccurrance) {
            if (this.sortCriteria == SortCriteria.RECEIVE_TIME && astNode.data.time2_receive !== undefined) {
                this.messages.push( new MessageSortData(astNode.data.time2_receive, astNode, line) );
            }
            else if (this.sortCriteria == SortCriteria.HANDLE_TIME && astNode.data.time3_handle !== undefined) {
                this.messages.push( new MessageSortData(astNode.data.time3_handle, astNode, line) );
            }
            
        }
        return astNode
    }

    /**
     * Sort stored messages by the specified criteria and then return all stored lines in that order
     * @returns 
     */
    public getSortedMessages() : LineAndNode[] {
        if (this.messages.length == 0) {            
            return [];
        }
        
        this.messages.sort( (a, b) => {
            return a.time - b.time;            
        });

        let result: LineAndNode[] = [];
        let startIndex = 0;
        let i = 0;
        for (const line of this.lines) {        
            let astNode = this.traceParser.parseLine(line, i++);
            if (astNode instanceof MessageOccurrance) {
                
                let index = startIndex;
                for (; index < this.messages.length; index++) {
                    let msg = this.messages[index];
                    if (msg.msg === line) {
                        let messages : LineAndNode[] = this.messages.slice(startIndex, index + 1).map(m => {return new LineAndNode(m.msg, m.msgOccurrance) }); 
                        result.push(...messages);
                        startIndex = index + 1;
                        break;
                    }                    
                }
            }
            else {
                result.push(new LineAndNode(line, astNode));
            }
        }

        return result;
    }
}