import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CustomerProdOrderStatus, MfgStageKind, Role } from '@prisma/client';
import { Roles } from '../common/guards';
import { MfgService } from './mfg.service';
import { ProdOrdersService } from './prod-orders.service';
import { ProductionService } from './production.service';

class BomLineDto {
  @IsString() materialId!: string;
  @IsNumber() quantity!: number;
}

class RecipeDto {
  @IsString() name!: string;
  @IsString() productId!: string;
  @IsOptional() @IsNumber() outputQty?: number;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => BomLineDto) lines!: BomLineDto[];
}

class UpdateRecipeDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsNumber() outputQty?: number;
  @IsOptional() @IsString() notes?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BomLineDto) lines?: BomLineDto[];
}

class PreviewDto {
  @IsString() recipeId!: string;
  @IsNumber() quantity!: number;
  @IsOptional() @IsString() rawWarehouseId?: string;
}

class OrderDto {
  @IsString() recipeId!: string;
  @IsNumber() quantity!: number;
  @IsOptional() @IsString() rawWarehouseId?: string;
  @IsOptional() @IsString() finishedWarehouseId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() post?: boolean;
}

class MfgIssueDto {
  @IsString() productId!: string;
  @IsNumber() quantity!: number;
}

class CreateMfgJobDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => MfgIssueDto)
  issues!: MfgIssueDto[];
}

class MfgCostLineDto {
  @IsOptional() @IsString() costTypeId?: string;
  @IsOptional() @IsString() label?: string;
  @IsNumber() amount!: number;
}

class CompleteStageDto {
  @IsOptional() @IsBoolean() skip?: boolean;
  @IsOptional() @IsNumber() qtyAfter?: number;
  @IsOptional() @IsNumber() weightBefore?: number;
  @IsOptional() @IsNumber() weightAfter?: number;
  @IsOptional() @IsNumber() wasteQty?: number;
  @IsOptional() @IsNumber() increaseQty?: number;
  @IsOptional() @IsNumber() pricePerKg?: number;
  @IsOptional() @IsNumber() coreCount?: number;
  @IsOptional() @IsNumber() coreUnitWeight?: number;
  @IsOptional() @IsNumber() bagCount?: number;
  @IsOptional() @IsNumber() bagUnitWeight?: number;
  @IsOptional() @IsNumber() netQty?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MfgCostLineDto)
  costs?: MfgCostLineDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MfgIssueDto)
  materials?: MfgIssueDto[];
}

class CreateProdOrderDto {
  @IsString() customerId!: string;
  @IsString() description!: string;
  @IsNumber() quantity!: number;
  @IsOptional() @IsNumber() unitPrice?: number;
  @IsOptional() @IsString() orderDate?: string;
  @IsOptional() @IsString() deliveryDate?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() productId?: string;
}

class UpdateProdOrderDto {
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() quantity?: number;
  @IsOptional() @IsNumber() unitPrice?: number;
  @IsOptional() @IsString() orderDate?: string;
  @IsOptional() @IsString() deliveryDate?: string | null;
  @IsOptional() @IsString() notes?: string | null;
  @IsOptional() @IsString() productId?: string | null;
  @IsOptional() @IsEnum(CustomerProdOrderStatus) status?: CustomerProdOrderStatus;
}

class TransferMfgDto {
  @IsNumber() quantity!: number;
  @IsNumber() salePrice!: number;
  @IsOptional() @IsString() productName?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() unit?: string;
}

@Controller('production')
@Roles(Role.ADMIN, Role.WAREHOUSE, Role.ACCOUNTANT, Role.SALES)
export class ProductionController {
  constructor(
    private service: ProductionService,
    private mfg: MfgService,
    private prodOrders: ProdOrdersService,
  ) {}

  // ─── أوردر إنتاج للعميل ───────────────────────────────────
  @Get('prod-orders')
  listProdOrders() {
    return this.prodOrders.list();
  }

  @Get('prod-orders/:id')
  getProdOrder(@Param('id') id: string) {
    return this.prodOrders.get(id);
  }

  @Post('prod-orders')
  createProdOrder(@Body() dto: CreateProdOrderDto, @Req() req: { user: { userId: string } }) {
    return this.prodOrders.create({ ...dto, createdById: req.user.userId });
  }

  @Patch('prod-orders/:id')
  updateProdOrder(@Param('id') id: string, @Body() dto: UpdateProdOrderDto) {
    return this.prodOrders.update(id, dto);
  }

  @Delete('prod-orders/:id')
  deleteProdOrder(@Param('id') id: string) {
    return this.prodOrders.remove(id);
  }

  @Get('warehouses')
  warehouses() {
    return this.service.warehouses();
  }

  @Post('warehouses/ensure')
  ensureWarehouses() {
    return this.service.ensureWarehouses();
  }

  @Get('recipes')
  listRecipes() {
    return this.service.listRecipes();
  }

  @Get('recipes/:id')
  getRecipe(@Param('id') id: string) {
    return this.service.getRecipe(id);
  }

  @Post('recipes')
  createRecipe(@Body() dto: RecipeDto) {
    return this.service.createRecipe(dto);
  }

  @Patch('recipes/:id')
  updateRecipe(@Param('id') id: string, @Body() dto: UpdateRecipeDto) {
    return this.service.updateRecipe(id, dto);
  }

  @Delete('recipes/:id')
  deleteRecipe(@Param('id') id: string) {
    return this.service.deleteRecipe(id);
  }

  @Get('orders')
  listOrders() {
    return this.service.listOrders();
  }

  @Get('orders/:id')
  getOrder(@Param('id') id: string) {
    return this.service.getOrder(id);
  }

  @Post('preview')
  preview(@Body() dto: PreviewDto) {
    return this.service.preview(dto);
  }

  @Post('orders')
  createOrder(@Body() dto: OrderDto, @Req() req: { user: { userId: string } }) {
    return this.service.createOrder({ ...dto, createdById: req.user.userId });
  }

  @Post('orders/:id/post')
  postOrder(@Param('id') id: string) {
    return this.service.postOrder(id);
  }

  @Delete('orders/:id')
  deleteOrder(@Param('id') id: string) {
    return this.service.deleteOrder(id);
  }

  // ─── مراحل التصنيع ───────────────────────────────────────
  @Get('mfg/cost-types')
  mfgCostTypes() {
    return this.mfg.listCostTypes();
  }

  @Post('mfg/cost-types')
  createMfgCostType(@Body() body: { name: string }) {
    return this.mfg.createCostType(body.name || '');
  }

  @Get('mfg/raw-stock')
  mfgRawStock() {
    return this.mfg.rawStock();
  }

  @Get('mfg/jobs')
  mfgJobs() {
    return this.mfg.listJobs();
  }

  @Get('mfg/jobs/:id')
  mfgJob(@Param('id') id: string) {
    return this.mfg.getJob(id);
  }

  @Post('mfg/jobs')
  createMfgJob(@Body() dto: CreateMfgJobDto, @Req() req: { user: { userId: string } }) {
    return this.mfg.createJob({ ...dto, createdById: req.user.userId });
  }

  @Post('mfg/jobs/:id/stages/:kind')
  completeMfgStage(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() dto: CompleteStageDto,
  ) {
    const normalized = kind.toUpperCase() as MfgStageKind;
    if (!Object.values(MfgStageKind).includes(normalized)) {
      throw new BadRequestException('مرحلة غير معروفة');
    }
    return this.mfg.completeStage(id, normalized, dto);
  }

  @Post('mfg/jobs/:id/transfer')
  transferMfg(@Param('id') id: string, @Body() dto: TransferMfgDto) {
    return this.mfg.transfer(id, dto);
  }
}
