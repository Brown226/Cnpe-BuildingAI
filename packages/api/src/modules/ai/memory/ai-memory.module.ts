import { TypeOrmModule } from "@buildingai/db/@nestjs/typeorm";
import { AgentMemory, UserMemory } from "@buildingai/db/entities";
import { Module } from "@nestjs/common";

import { ScopeModule } from "@common/modules/scope/scope.module";
import { UserMemoryWebController } from "./controllers/web/user-memory.controller";
import { ScopedMemoryConsoleController } from "./controllers/console/scoped-memory.controller";
import { MemoryService } from "./services/memory.service";
import { MemoryExtractionService } from "./services/memory-extraction.service";

@Module({
    imports: [TypeOrmModule.forFeature([UserMemory, AgentMemory]), ScopeModule],
    controllers: [UserMemoryWebController, ScopedMemoryConsoleController],
    providers: [MemoryService, MemoryExtractionService],
    exports: [MemoryService, MemoryExtractionService],
})
export class AiMemoryModule {}
