import { registerAs } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';

export const typeOrmDataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [__dirname + '/../database/entities/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/**/*{.ts,.js}'],
  synchronize: false,
  logging:
    process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  extra: {
    // Nem o banco (`statement_timeout` = 0) nem o pool tinham limite algum —
    // uma query travada segurava a conexão para sempre. 3600s cobre o pior
    // caso real de hoje (migration de backfill, ingestão de milhares de
    // linhas via TenantTxHost/DataSource fora de transação em lote) sem
    // travar operação nenhuma; é rede de segurança, não o timeout esperado no
    // caminho comum. Vale tanto para o pool do NestJS (TypeOrmModule.forRoot)
    // quanto para o DataSource usado pelo CLI de migration — mesmo objeto.
    statement_timeout: 3_600_000,
    query_timeout: 3_600_000,
  },
};

export const typeOrmConfig = registerAs(
  'typeorm',
  () => typeOrmDataSourceOptions,
);

// Used by the TypeORM CLI (migration:generate/run) outside the Nest DI context.
export default new DataSource(typeOrmDataSourceOptions);
