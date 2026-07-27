import { IsIn } from 'class-validator';

export class SetAvailabilityDto {
  @IsIn([0, 1, 2])
  availability!: 0 | 1 | 2;
}
