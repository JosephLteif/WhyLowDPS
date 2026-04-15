# WhyLowDps Makefile

COMPOSE_DEV = docker-compose.yml

.PHONY: help serve stop rebuild logs clean

help:
	@echo "WhyLowDps Commands:"
	@echo "  make serve            - Start the development environment (Docker)"
	@echo "  make stop             - Stop the development environment"
	@echo "  make rebuild          - Rebuild containers and start"
	@echo "  make logs             - Show real-time logs from all containers"
	@echo "  make clean            - Stop environment and remove all volumes (reset database)"

serve:
	docker compose -f $(COMPOSE_DEV) up

stop:
	docker compose -f $(COMPOSE_DEV) down

rebuild:
	docker compose -f $(COMPOSE_DEV) up --build

logs:
	docker compose -f $(COMPOSE_DEV) logs -f

clean:
	docker compose -f $(COMPOSE_DEV) down -v
