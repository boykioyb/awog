import { register } from '../transport/rpc.js'
import { listProjects } from '../projects/store.js'

register('projects.list', async () => {
  const projects = await listProjects()
  return { projects }
})
