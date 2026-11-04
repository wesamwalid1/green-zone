import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EditPasswordGuard } from './settings/edit-password.guard';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { ProductsModule } from './products/products.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { CustomersModule } from './customers/customers.module';
import { CashModule } from './cash/cash.module';
import { SalesModule } from './sales/sales.module';
import { PurchasesModule } from './purchases/purchases.module';
import { ReturnsModule } from './returns/returns.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SettingsModule } from './settings/settings.module';
import { StockModule } from './stock/stock.module';
import { FinanceModule } from './finance/finance.module';
import { DocumentsModule } from './documents/documents.module';
import { OpsModule } from './ops/ops.module';
import { OrgModule } from './org/org.module';
import { WorkModule } from './work/work.module';
import { HrModule } from './hr/hr.module';
import { ProductionModule } from './production/production.module';
import { PartnersModule } from './partners/partners.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    PrismaModule,
    AuthModule,
    UsersModule,
    WarehousesModule,
    ProductsModule,
    StockModule,
    SuppliersModule,
    CustomersModule,
    CashModule,
    SalesModule,
    PurchasesModule,
    ReturnsModule,
    ReportsModule,
    DashboardModule,
    SettingsModule,
    FinanceModule,
    DocumentsModule,
    OpsModule,
    OrgModule,
    WorkModule,
    HrModule,
    ProductionModule,
    PartnersModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: EditPasswordGuard }],
})
export class AppModule {}
