import { Type } from "class-transformer";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

/** 管理端创建部门/组织共享记忆（T4.3：共享记忆仅管理端可写） */
export class CreateScopedMemoryDto {
    @IsIn(["department", "org"], { message: "scopeType 仅支持 department | org" })
    scopeType: "department" | "org";

    @IsOptional()
    @IsUUID()
    departmentId?: string;

    @IsString()
    @MaxLength(2000)
    content: string;

    @IsString()
    @MaxLength(50)
    category: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    source?: string;
}

/** 管理端共享记忆列表查询 */
export class ListScopedMemoriesDto {
    @IsIn(["department", "org"], { message: "scopeType 仅支持 department | org" })
    scopeType: "department" | "org";

    @IsOptional()
    @IsUUID()
    departmentId?: string;

    @IsOptional()
    @Type(() => Number)
    limit?: number;
}
