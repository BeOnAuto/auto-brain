import { connectionBehaviour } from '../access-testing/connection-behaviour.ts';
import { apiUnderTest, mcpUnderTest } from '../access-testing/servers-under-test.ts';
import { throughAConnection, throughTheFile } from '../access-testing/sources-under-test.ts';
import { toolAccessBehaviour } from '../access-testing/tool-access-behaviour.ts';

toolAccessBehaviour(mcpUnderTest, throughTheFile);
toolAccessBehaviour(apiUnderTest, throughTheFile);
toolAccessBehaviour(mcpUnderTest, throughAConnection);
toolAccessBehaviour(apiUnderTest, throughAConnection);
connectionBehaviour(mcpUnderTest);
connectionBehaviour(apiUnderTest);
