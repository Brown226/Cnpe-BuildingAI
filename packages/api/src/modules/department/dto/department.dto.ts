import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, Length } from "class-validator";

/**
 * 创建部门DTO
 */
export class CreateDepartmentDto {
    /**
     * 部门名称
     */
    @IsNotEmpty({ message: "部门名称不能为空" })
    @IsString({ message: "部门名称必须是字符串" })
    @Length(1, 64, { message: "部门名称长度必须在1-64个字符之间" })
    name: string;

    /**
     * 父部门ID（为空表示一级部门）
     */
    @IsOptional()
    @IsUUID(4, { message: "父部门ID必须是有效的UUID格式" })
    parentId?: string;
}

/**
 * 更新部门DTO
 */
export class UpdateDepartmentDto {
    /**
     * 部门名称
     */
    @IsOptional()
    @IsString({ message: "部门名称必须是字符串" })
    @Length(1, 64, { message: "部门名称长度必须在1-64个字符之间" })
    name?: string;

    /**
     * 父部门ID（为空表示一级部门）
     */
    @IsOptional()
    @IsUUID(4, { message: "父部门ID必须是有效的UUID格式" })
    parentId?: string | null;
}

/**
 * 批量删除部门DTO
 */
export class DeleteDepartmentDto {
    /**
     * 部门ID
     */
    @IsNotEmpty({ message: "部门ID不能为空" })
    @IsUUID(4, { message: "部门ID必须是有效的UUID格式" })
    id: string;
}