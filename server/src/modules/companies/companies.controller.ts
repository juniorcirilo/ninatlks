import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { CompaniesService } from './companies.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { LinkCompanyDto, LinkCompanyImportDto } from './dto/link-company.dto';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  /** Empresas cadastradas — usado pelo picker de "empresa existente" na
   * tela (busca por nome/razão social/empresa_id), não é a lista principal. */
  @Get()
  list(@Param('accountId') accountId: string, @Query('search') search?: string) {
    return this.companiesService.list(accountId, search);
  }

  /** Clientes com a empresa que já têm vinculada — lista principal da tela
   * Empresas: aqui empresa nasce sempre a partir de um cliente. */
  @Get('clients')
  listClients(@Param('accountId') accountId: string, @Query('search') search?: string) {
    return this.companiesService.listClients(accountId, search);
  }

  @Get(':id')
  get(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.companiesService.get(accountId, id);
  }

  @Get(':id/contacts')
  listContacts(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.companiesService.listCompanyContacts(accountId, id);
  }

  @Post()
  create(@Param('accountId') accountId: string, @Body() dto: CreateCompanyDto) {
    return this.companiesService.create(accountId, dto);
  }

  /** Vincula um cliente já existente à empresa dele (achada/criada por
   * empresa_id, ou uma empresa avulsa nova). */
  @Post('link')
  link(@Param('accountId') accountId: string, @Body() dto: LinkCompanyDto) {
    return this.companiesService.linkClient(accountId, dto);
  }

  /** Import em massa: cada linha identifica o cliente por telefone e a
   * empresa por empresa_id (acha/cria). */
  @Post('link/import')
  linkImport(@Param('accountId') accountId: string, @Body() dto: LinkCompanyImportDto) {
    return this.companiesService.bulkLinkClients(accountId, dto.rows);
  }

  @Patch(':id')
  update(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.update(accountId, id, dto);
  }

  @Delete(':id')
  async remove(@Param('accountId') accountId: string, @Param('id') id: string) {
    await this.companiesService.delete(accountId, id);
    return { ok: true };
  }

  /** Apaga TODAS as empresas desta conta — botão "Truncar" da tela. */
  @Delete()
  deleteAll(@Param('accountId') accountId: string) {
    return this.companiesService.deleteAll(accountId);
  }
}
