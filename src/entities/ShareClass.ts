import type { Centrifuge } from '../Centrifuge.js'
import { Entity } from './Entity.js'
import type { Pool } from './Pool.js'

export class ShareClass extends Entity {
  /** @internal */
  constructor(
    _root: Centrifuge,
    public pool: Pool,
    public id: string
  ) {
    super(_root, ['shareclass', id])
  }
}
