import { register } from '../transport/rpc.js'
import { listTasks } from '../tasks/store.js'

register('tasks.list', async () => {
  const tasks = await listTasks()
  return { tasks }
})
