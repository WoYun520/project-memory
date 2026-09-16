import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createDesktopMcpServer} from './server/desktop-mcp.mjs';
try{
 const server=createDesktopMcpServer({port:Number(process.env.MEMORY_STATION_PORT||4180),projectIds:JSON.parse(process.env.MEMORY_STATION_PROJECTS||'[]'),dataId:process.env.MEMORY_STATION_DATA_ID});
 await server.connect(new StdioServerTransport());
}catch{process.stderr.write('记忆站连接设置无效，请回记忆站重新连接。\n');process.exitCode=1;}
