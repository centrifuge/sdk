import type { Centrifuge } from '../Centrifuge.js'
import { Entity } from './Entity.js'

export class ShareClass extends Entity {
  /** @internal */
  constructor(
    _root: Centrifuge,
    public id: string
  ) {
    super(_root, ['pool', id])
  }
}
