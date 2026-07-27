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
};

export const typeOrmConfig = registerAs(
  'typeorm',
  () => typeOrmDataSourceOptions,
);

// Used by the TypeORM CLI (migration:generate/run) outside the Nest DI context.
export default new DataSource(typeOrmDataSourceOptions);
