import { apiUnderTest, mcpUnderTest } from '../access-testing/servers-under-test.ts';
import { toolAccessBehaviour } from '../access-testing/tool-access-behaviour.ts';

toolAccessBehaviour(mcpUnderTest);
toolAccessBehaviour(apiUnderTest);
