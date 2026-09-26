import { Client } from '@elastic/elasticsearch';
import { config } from '../config/env';
import { prisma } from '../prisma/client';

export const ES_EMAIL_INDEX = 'reachflow_emails';

export class ElasticsearchService {
  private client: Client | null = null;
  private isConnected = false;

  constructor() {
    if (config.enableElasticsearch && config.elasticsearchNode) {
      try {
        this.client = new Client({
          node: config.elasticsearchNode,
          auth:
            config.elasticsearchUsername && config.elasticsearchPassword
              ? {
                  username: config.elasticsearchUsername,
                  password: config.elasticsearchPassword,
                }
              : undefined,
          tls: {
            rejectUnauthorized: false,
          },
        });
      } catch (err) {
        console.warn('[Elasticsearch] Could not construct client:', (err as Error).message);
      }
    }
  }

  /**
   * Initializes the Elasticsearch index with appropriate mapping
   */
  public async initializeIndex(): Promise<boolean> {
    if (!this.client) return false;

    try {
      const exists = await this.client.indices.exists({ index: ES_EMAIL_INDEX });
      if (!exists) {
        await this.client.indices.create({
          index: ES_EMAIL_INDEX,
          body: {
            mappings: {
              properties: {
                id: { type: 'keyword' },
                userId: { type: 'keyword' },
                campaignId: { type: 'keyword' },
                senderId: { type: 'keyword' },
                senderEmail: { type: 'keyword' },
                recipient: {
                  type: 'text',
                  fields: {
                    keyword: { type: 'keyword' },
                  },
                },
                subject: { type: 'text' },
                body: { type: 'text' },
                status: { type: 'keyword' },
                scheduledAt: { type: 'date' },
                sentAt: { type: 'date' },
              },
            },
          },
        });
        console.log(`[Elasticsearch] Created index '${ES_EMAIL_INDEX}'`);
      }
      this.isConnected = true;
      return true;
    } catch (error) {
      console.warn('[Elasticsearch] Initialization error (search fallback active):', (error as Error).message);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Indexes or updates an email document.
   * Never throws uncaught errors that can fail email delivery.
   */
  public async indexEmail(email: {
    id: string;
    userId: string;
    campaignId: string;
    senderId: string;
    senderEmail?: string;
    recipient: string;
    subject: string;
    body: string;
    status: string;
    scheduledAt: Date;
    sentAt?: Date | null;
  }): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      await this.client.index({
        index: ES_EMAIL_INDEX,
        id: email.id,
        document: {
          id: email.id,
          userId: email.userId,
          campaignId: email.campaignId,
          senderId: email.senderId,
          senderEmail: email.senderEmail || '',
          recipient: email.recipient,
          subject: email.subject,
          body: email.body,
          status: email.status,
          scheduledAt: email.scheduledAt.toISOString(),
          sentAt: email.sentAt ? email.sentAt.toISOString() : null,
        },
      });
    } catch (err) {
      console.warn(`[Elasticsearch] Indexing failed for email ${email.id}:`, (err as Error).message);
      throw err; // Let caller (BullMQ esIndexWorker) retry if desired
    }
  }

  /**
   * Performs multi-match full-text search across emails with graceful PostgreSQL fallback
   */
  public async searchEmails(params: {
    userId: string;
    query?: string;
    status?: string;
    page: number;
    limit: number;
  }) {
    const { userId, query, status, page, limit } = params;
    const from = (page - 1) * limit;

    // If Elasticsearch is reachable, execute multi-match query
    if (this.client && this.isConnected && query) {
      try {
        const mustClauses: any[] = [{ term: { userId } }];
        if (status) {
          mustClauses.push({ term: { status } });
        }

        const shouldClauses: any[] = [
          {
            multi_match: {
              query,
              fields: ['recipient^3', 'subject^2', 'body', 'senderEmail'],
              fuzziness: 'AUTO',
            },
          },
          {
            wildcard: {
              'recipient.keyword': `*${query.toLowerCase()}*`,
            },
          },
        ];

        const response = await this.client.search({
          index: ES_EMAIL_INDEX,
          from,
          size: limit,
          query: {
            bool: {
              must: mustClauses,
              should: shouldClauses,
              minimum_should_match: 1,
            },
          },
          sort: [{ scheduledAt: { order: 'desc' } }],
        });

        const hits = response.hits.hits;
        const total = typeof response.hits.total === 'number' ? response.hits.total : response.hits.total?.value || 0;
        const emailIds = hits.map((hit: any) => hit._source.id);

        // Fetch full relational records from PostgreSQL to include events and relations
        const emails = await prisma.email.findMany({
          where: { id: { in: emailIds } },
          include: {
            sender: { select: { email: true, name: true } },
            events: { orderBy: { createdAt: 'asc' } },
          },
          orderBy: { scheduledAt: 'desc' },
        });

        return {
          total,
          page,
          limit,
          source: 'elasticsearch',
          emails,
        };
      } catch (esError) {
        console.warn('[Elasticsearch] Search query failed, falling back to PostgreSQL:', (esError as Error).message);
      }
    }

    // Reliable PostgreSQL Search Fallback
    const where: any = { userId };
    if (status) {
      where.status = status;
    }
    if (query) {
      where.OR = [
        { recipient: { contains: query, mode: 'insensitive' } },
        { subject: { contains: query, mode: 'insensitive' } },
        { body: { contains: query, mode: 'insensitive' } },
      ];
    }

    const [total, emails] = await Promise.all([
      prisma.email.count({ where }),
      prisma.email.findMany({
        where,
        include: {
          sender: { select: { email: true, name: true } },
          events: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { scheduledAt: 'desc' },
        skip: from,
        take: limit,
      }),
    ]);

    return {
      total,
      page,
      limit,
      source: 'postgres',
      emails,
    };
  }

  public getStatus() {
    return {
      configured: config.enableElasticsearch,
      connected: this.isConnected,
    };
  }
}

export const elasticsearchService = new ElasticsearchService();
