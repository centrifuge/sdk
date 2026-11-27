import { expect } from 'chai'
import { OPERATION_CATALOGUE, operationByCall, operationById, operationByPoolAction } from './index.js'

describe('operationCatalogue', () => {
  it('is re-exported from the SDK root with its lookups', () => {
    expect(OPERATION_CATALOGUE.length).to.be.greaterThan(0)
    expect(operationById('hub.managerCall')?.name).to.equal('Manager call')
    expect(operationByPoolAction('issueShares')?.name).to.equal('Share issue')
    expect(operationByCall('Hub', 'updateRestriction', 'Freeze')?.name).to.equal('Restriction update')
  })
})
