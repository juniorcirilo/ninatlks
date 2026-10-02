import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { BulkSalesRepsDto, UpsertSalesRepDto } from './dto/sales-rep.dto';
import { SalesRepsService } from './sales-reps.service';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/sales-reps')
export class SalesRepsController {
  constructor(private readonly service: SalesRepsService) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.service.list(accountId);
  }

  /** Leads cujo vendedor não resolveu (sem cadastro/sem telefone) — caíram no número central. */
  @Get('pendencias')
  pendencias(@Param('accountId') accountId: string) {
    return this.service.listPendencias(accountId);
  }

  @Post()
  create(@Param('accountId') accountId: string, @Body() dto: UpsertSalesRepDto) {
    return this.service.create(accountId, dto);
  }

  /** Carga inicial: { items: [{ nome, aliases?, phone, email? }] } */
  @Post('bulk')
  bulk(@Param('accountId') accountId: string, @Body() dto: BulkSalesRepsDto) {
    return this.service.bulk(accountId, dto);
  }

  @Patch(':id')
  update(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() dto: UpsertSalesRepDto,
  ) {
    return this.service.update(accountId, id, dto);
  }

  @Delete(':id')
  remove(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.service.remove(accountId, id);
  }
}
