import prisma from './app/db.server.ts';
console.log(await prisma.session.count());
await prisma.();
